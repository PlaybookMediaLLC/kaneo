import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z } from "../../openapi";
import { principal, user as customer } from "../../database/quills/schema/auth";
import {
  conversationFollowers,
  conversationMessages,
  conversationParticipants,
  conversations,
} from "../../database/quills/schema/conversation";
import { files } from "../../database/quills/schema/files";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import {
  downloadResendAttachment,
  fetchReceivedEmail,
  findWorkspaceTeammateByEmail,
  ownMessageIds,
  replyAddressConversation,
  replyAddressPost,
  resendInbound,
  storeInboundEmailAttachments,
  type ReceivedEmailAttachmentInput,
  type StoredInboundFile,
} from "../framework/signed";
import { commentByMail } from "./post-reply";
import { preview } from "../support/conversation-model";
import { trustedEmailAuth } from "./email-auth";
import { reopened } from "../support/conversation-ops";
import { parseForwardedEmail, parseMailboxList } from "./forward-parser";
import {
  extractDataUriImages,
  normalizeContentId,
  rewriteCidToQuillsFiles,
  sanitizeInboundHtml,
} from "./html-media";
import { detectAutomatedEmail } from "./automated";
import { readReopenPolicy } from "../support/support-settings";

// POST /quills-public/signed/chat/email/inbound: mail that Resend received for a workspace address
// on EMAIL_INBOUND_DOMAIN (`<workspace slug>@domain` or `<slug>+tag@domain`).
// Supports:
// - Standard customer emails & threaded replies (including CC'd participants).
// - Teammate-forwarded customer emails (#325): sets original customer as requester, adds teammate
//   to conversation_followers, saves preamble as an internal note, preserves CCs, flags
//   forward_parse_failed when Outlook/client stripped the original email address.
// - Inline images & attachments (#326): downloads attachments + extracts base64 data URIs outside
//   DB transactions, uploads to object storage, rewrites cid: references to quills-file://<id>.

type ConversationId = (typeof conversations.$inferSelect)["id"];
type MessageId = (typeof conversationMessages.$inferSelect)["id"];
type PrincipalId = (typeof principal.$inferSelect)["id"];

const MAX_REFERENCES = 20;
const header = z.string().max(100_000);
const inboundAttachmentInput = z.object({
  id: z.string().max(200).optional(),
  filename: z.string().max(255).default("attachment"),
  content_type: z.string().max(255).optional(),
  contentType: z.string().max(255).optional(),
  content_id: z.string().max(255).optional(),
  contentId: z.string().max(255).optional(),
  content_disposition: z.string().max(64).optional(),
  disposition: z.string().max(64).optional(),
  content_base64: z.string().max(14_000_000).optional(),
  download_url: z.string().max(2048).optional(),
});
const received = z.object({
  type: z.string().max(64),
  data: z
    .object({
      email_id: z.string().max(200).optional(),
      from: z.string().max(998).optional(),
      to: z.array(z.string().max(998)).max(1000).optional(),
      cc: z.array(z.string().max(998)).max(100).optional(),
      subject: z.string().max(998).optional(),
      text: z.string().max(100_000).optional(),
      html: z.string().max(300_000).optional(),
      message_id: z.string().max(998).optional(),
      attachments: z.array(inboundAttachmentInput).max(20).optional(),
      headers: z
        .union([
          z
            .record(z.string().max(100), header)
            .refine((value) => Object.keys(value).length <= 1000),
          z
            .array(z.object({ name: z.string().max(100), value: header }))
            .max(1000),
        ])
        .optional(),
    })
    .default({}),
});
type Received = z.output<typeof received>["data"];

function readHeaders(headers: Received["headers"], name: string): string[] {
  if (!headers) return [];
  const entries = Array.isArray(headers)
    ? headers.map((entry) => [entry.name, entry.value] as const)
    : Object.entries(headers);
  return entries
    .filter(([key]) => key.toLowerCase() === name)
    .map(([, value]) => value);
}
const readHeader = (headers: Received["headers"], name: string) =>
  readHeaders(headers, name)[0];

function mailbox(value: string | undefined) {
  const match = /^\s*(?:"?([^"<]*)"?\s*)?<([^<>\s]+@[^<>\s]+)>\s*$/.exec(
    value ?? "",
  );
  const address = (match?.[2] ?? value ?? "").trim().toLowerCase();
  if (!/^[^\s@<>]{1,64}@[^\s@<>]{1,255}$/.test(address)) return null;
  return { address, name: match?.[1]?.trim() || address.split("@")[0]! };
}
const messageIds = (value: string | undefined) =>
  (value?.match(/<[^<>\s]{1,900}>/g) ?? []).slice(0, MAX_REFERENCES);

function fileFamily(type: string) {
  return type.startsWith("image/")
    ? ("image" as const)
    : type.startsWith("video/")
      ? ("video" as const)
      : type.startsWith("audio/")
        ? ("audio" as const)
        : type === "application/pdf"
          ? ("pdf" as const)
          : type === "text/csv"
            ? ("csv" as const)
            : type.startsWith("text/")
              ? ("text" as const)
              : ("other" as const);
}

/** The sender's customer profile and principal, created on first mail. Null when it is blocked. */
async function senderPrincipal(
  db: Database,
  sender: { address: string; name: string },
) {
  const find = async () =>
    (
      await db
        .select({ id: customer.id })
        .from(customer)
        .where(sql`lower(${customer.email}) = ${sender.address}`)
        .limit(1)
    )[0];
  if (!(await find()))
    await db
      .insert(customer)
      .values({
        name: sender.name.slice(0, 200),
        email: sender.address,
        emailVerified: false,
      })
      .onConflictDoNothing();
  const identity = (await find())!;
  await db
    .insert(principal)
    .values({
      userId: identity.id,
      role: "user",
      type: "user",
      displayName: sender.name.slice(0, 200),
      createdAt: new Date(),
    })
    .onConflictDoNothing();
  const [person] = await db
    .select({ id: principal.id, blockedAt: principal.blockedAt })
    .from(principal)
    .where(eq(principal.userId, identity.id))
    .limit(1);
  return person && !person.blockedAt ? person.id : null;
}

/** Finds or provisions the Quills teammate principal for a verified workspace member. */
async function teammatePrincipal(
  db: Database,
  teammate: { userId: string; name: string },
): Promise<PrincipalId> {
  const find = async () =>
    (
      await db
        .select({ id: principal.id })
        .from(principal)
        .where(eq(principal.kaneoUserId, teammate.userId))
        .limit(1)
    )[0];
  const existing = await find();
  if (existing) return existing.id;
  await db
    .insert(principal)
    .values({
      kaneoUserId: teammate.userId,
      role: "member",
      type: "user",
      displayName: teammate.name.slice(0, 200),
      createdAt: new Date(),
    })
    .onConflictDoNothing();
  return (await find())!.id;
}

interface CalledInboundData {
  text: string | null;
  html: string | null;
  cc: string[];
  headers: Received["headers"];
  teammate: { userId: string; name: string } | null;
  rfc822Text: string | null;
  storedFiles: StoredInboundFile[];
  dataImagePlaceholders: { placeholder: string; storageKey: string }[];
}

const inbound = defineQuillsRoute({
  audience: "signed",
  verifier: resendInbound,
  method: "post",
  path: "/chat/email/inbound",
  operationId: "receiveQuillsInboundEmail",
  summary: "Receive a mail for a workspace address (Resend inbound webhook)",
  description:
    "404 until EMAIL_INBOUND_SIGNING_SECRET and EMAIL_INBOUND_DOMAIN are set. Fetches body/HTML/attachments from Resend when absent, supports teammate-forwarded customer emails (#325), and preserves inline images (#326).",
  action: "create",
  body: received,
  response: z.object({
    status: z.enum([
      "received",
      "duplicate",
      "ignored",
      "empty",
      "rejected",
      "blocked",
      "from_mismatch",
    ]),
    messageId: z.string().nullable(),
    commentId: z.string().nullable().optional().openapi({
      description: "The comment that a reply to a post notification became",
    }),
  }),
  responseDescription:
    "What happened to the mail. A refused mail is acknowledged so the provider stops retrying.",
  replay: { status: "duplicate", messageId: null },
  errors: { 409: "A concurrent copy of this mail is being stored; retry" },
  prepare: async ({ workspaceId, body }) => ({
    workspaceId,
    isReceived: body.type === "email.received",
    rawEmailId:
      body.type === "email.received" ? (body.data.email_id ?? null) : null,
    shouldFetchBody:
      body.type === "email.received" && !body.data.text && !body.data.html,
    from: body.data.from ?? null,
    rawHtml: body.data.html ?? null,
    rawAttachments: body.data.attachments ?? [],
  }),
  // No transaction is open: Resend fetch, teammate membership check, and object storage uploads.
  call: async (prep): Promise<CalledInboundData | null> => {
    if (!prep.isReceived) return null;
    const fetched =
      prep.shouldFetchBody && prep.rawEmailId
        ? await fetchReceivedEmail(prep.rawEmailId)
        : null;
    const sender = mailbox(prep.from ?? undefined);
    const teammate = sender
      ? await findWorkspaceTeammateByEmail(prep.workspaceId, sender.address)
      : null;

    const rawHtml = fetched?.html ?? prep.rawHtml ?? null;
    const mappedPrepAttachments: ReceivedEmailAttachmentInput[] =
      prep.rawAttachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType:
          a.content_type ?? a.contentType ?? "application/octet-stream",
        contentId: a.content_id ?? a.contentId,
        disposition: a.content_disposition ?? a.disposition,
        contentBase64: a.content_base64,
        downloadUrl: a.download_url,
      }));
    // Resend's webhook already lists attachment metadata; prefer fetched descriptors when present
    // rather than concatenating both lists (which duplicated every attachment).
    const rawAttachments: ReceivedEmailAttachmentInput[] =
      fetched?.attachments && fetched.attachments.length > 0
        ? fetched.attachments
        : mappedPrepAttachments;

    let rfc822Text: string | null = null;
    const uploadQueue: {
      filename: string;
      contentType: string;
      bytes: Uint8Array;
      contentId: string | null;
      inline: boolean;
      placeholder?: string;
    }[] = [];

    for (const att of rawAttachments.slice(0, 10)) {
      const bytes = await downloadResendAttachment(prep.rawEmailId ?? "", att);
      if (!bytes) continue;
      if (
        att.contentType.toLowerCase().startsWith("message/rfc822") &&
        !rfc822Text
      ) {
        rfc822Text = Buffer.from(bytes).toString("utf8");
        continue;
      }
      const cid = normalizeContentId(att.contentId);
      const isInline =
        Boolean(cid) || (att.disposition ?? "").toLowerCase() === "inline";
      uploadQueue.push({
        filename: att.filename,
        contentType: att.contentType,
        bytes,
        contentId: cid,
        inline: isInline,
      });
    }

    let htmlForStore: string | null = null;
    const dataImagePlaceholders: { placeholder: string; storageKey: string }[] =
      [];
    if (rawHtml) {
      const extracted = extractDataUriImages(rawHtml);
      htmlForStore = sanitizeInboundHtml(extracted.text);
      for (const img of extracted.images) {
        uploadQueue.push({
          filename: img.filename,
          contentType: img.contentType,
          bytes: img.bytes,
          contentId: null,
          inline: true,
          placeholder: img.placeholder,
        });
      }
    }

    const storedFiles = await storeInboundEmailAttachments(
      prep.workspaceId,
      uploadQueue,
    );
    for (const stored of storedFiles) {
      if (stored.placeholder) {
        dataImagePlaceholders.push({
          placeholder: stored.placeholder,
          storageKey: stored.storageKey,
        });
      }
    }

    return {
      text: fetched?.text ?? null,
      html: htmlForStore,
      cc: fetched?.cc ?? [],
      headers: fetched?.headers ?? undefined,
      teammate,
      rfc822Text,
      storedFiles,
      dataImagePlaceholders,
    };
  },
  event: (_input, result) =>
    result.status === "received" &&
    (result.commentId
      ? {
          type: "comment.created",
          entityType: "comment",
          entityId: result.commentId,
        }
      : result.messageId !== null && {
          type: "conversation.email_received",
          entityType: "conversation_message",
          entityId: result.messageId,
        }),
  handler: async ({ db, body, called, workspaceId }) => {
    const answer = (
      status:
        | "duplicate"
        | "ignored"
        | "empty"
        | "rejected"
        | "blocked"
        | "from_mismatch",
    ) => ({ status, messageId: null });
    if (body.type !== "email.received") return answer("ignored");
    const data = body.data;
    const sender = mailbox(data.from);
    if (!sender) return answer("rejected");

    const hasDataHeaders =
      data.headers !== undefined &&
      (Array.isArray(data.headers)
        ? data.headers.length > 0
        : Object.keys(data.headers).length > 0);
    const effectiveHeaders = hasDataHeaders ? data.headers : called?.headers;
    const rawText = (called?.text ?? data.text ?? "").trim();
    const rawHtml =
      called?.html ?? (data.html ? sanitizeInboundHtml(data.html) : null);
    if (!rawText && !rawHtml) return answer("empty");

    const emailMessageId = (
      messageIds(readHeader(effectiveHeaders, "message-id"))[0] ??
      data.message_id ??
      data.email_id
    )?.slice(0, 998);

    // Post notification reply path
    const postId = replyAddressPost(data.to ?? [], workspaceId);
    if (postId) {
      const reply = await commentByMail(db, {
        postId: postId as never,
        address: sender.address,
        text: rawText.slice(0, 10_000),
        emailMessageId,
      });
      return reply.status === "received"
        ? {
            status: "received" as const,
            messageId: null,
            commentId: reply.commentId,
          }
        : answer(reply.status);
    }

    if (emailMessageId) {
      const [seen] = await db
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(
          sql`${conversationMessages.metadata} ->> 'emailMessageId' = ${emailMessageId}`,
        )
        .limit(1);
      if (seen) return answer("duplicate");
    }

    const authHeaders = readHeaders(effectiveHeaders, "authentication-results");
    const emailAuth =
      authHeaders.length > 0
        ? trustedEmailAuth(
            authHeaders,
            process.env.EMAIL_INBOUND_AUTHSERV_ID ?? "",
          )
        : null;

    // Detect whether this email is automated (OOO/bounce/auto-reply) for #311/#331 metadata
    const plainFallback =
      rawText || (rawHtml ? rawHtml.replace(/<[^>]+>/g, " ").trim() : "");
    const automated = detectAutomatedEmail({
      from: data.from,
      subject: data.subject,
      body: plainFallback,
      headers: effectiveHeaders,
    });

    // Resolve existing thread BEFORE evaluating teammate forwarding so replies to existing
    // threads can never hijack requester attribution or inject forged internal notes (#325).
    const references = [
      ...messageIds(readHeader(effectiveHeaders, "in-reply-to")),
      ...messageIds(readHeader(effectiveHeaders, "references")),
    ].slice(0, MAX_REFERENCES);
    const threadColumns = {
      id: conversations.id,
      status: conversations.status,
      endReason: conversations.endReason,
      visitorPrincipalId: conversations.visitorPrincipalId,
      waitingSince: conversations.waitingSince,
      resolvedAt: conversations.resolvedAt,
      updatedAt: conversations.updatedAt,
      lastMessageAt: conversations.lastMessageAt,
      reopenedCount: conversations.reopenedCount,
    };

    const addressed = replyAddressConversation(data.to ?? [], workspaceId);
    const [byAddress] = addressed
      ? await db
          .select(threadColumns)
          .from(conversations)
          .where(
            and(
              eq(conversations.id, addressed as ConversationId),
              eq(conversations.channel, "email"),
            ),
          )
          .for("update")
      : [];

    const ours = ownMessageIds(references) as MessageId[];
    const [thread] = byAddress
      ? [byAddress]
      : references.length
        ? await db
            .select(threadColumns)
            .from(conversationMessages)
            .innerJoin(
              conversations,
              eq(conversations.id, conversationMessages.conversationId),
            )
            .where(
              and(
                eq(conversations.channel, "email"),
                or(
                  inArray(
                    sql<string>`${conversationMessages.metadata} ->> 'emailMessageId'`,
                    references,
                  ),
                  ours.length
                    ? and(
                        inArray(conversationMessages.id, ours),
                        eq(conversationMessages.senderType, "agent"),
                        eq(conversationMessages.isInternal, false),
                      )
                    : undefined,
                ),
              ),
            )
            .limit(1)
            .for("update")
        : [];

    // Gather CC headers from webhook, Resend fetch, and raw Cc header
    const ccHeaderValues = [
      ...(data.cc ?? []),
      ...(called?.cc ?? []),
      ...readHeaders(effectiveHeaders, "cc"),
    ];

    // Check for teammate-forwarded customer email (#325) on NEW conversations only.
    // Fail CLOSED: requires verified active teammate AND trusted DMARC=pass authentication.
    const isAuthenticatedTeammateForward =
      !thread &&
      Boolean(called?.teammate) &&
      emailAuth !== null &&
      emailAuth.dmarc === "pass";
    const forwardParsed = isAuthenticatedTeammateForward
      ? parseForwardedEmail({
          subject: data.subject,
          text: rawText,
          html: rawHtml ?? undefined,
          cc: ccHeaderValues,
          rfc822Text: called?.rfc822Text ?? undefined,
        })
      : null;

    const effectiveRequester =
      forwardParsed?.isForward && forwardParsed.requester
        ? forwardParsed.requester
        : sender;
    const effectiveSubject = forwardParsed?.isForward
      ? forwardParsed.subject
      : data.subject?.slice(0, 500) || null;
    const effectiveBody = (
      forwardParsed?.isForward && forwardParsed.forwardedBody
        ? forwardParsed.forwardedBody
        : plainFallback
    ).slice(0, 10_000);
    if (!effectiveBody) return answer("empty");

    const requesterId = await senderPrincipal(db, effectiveRequester);
    if (!requesterId) return answer("blocked");

    // Allow replies from the conversation's requester OR any CC'd participant (#325).
    let senderId = requesterId;
    if (thread && thread.visitorPrincipalId !== requesterId) {
      const actualSenderId = await senderPrincipal(db, sender);
      const [participantRow] = actualSenderId
        ? await db
            .select({ principalId: conversationParticipants.principalId })
            .from(conversationParticipants)
            .where(
              and(
                eq(conversationParticipants.conversationId, thread.id),
                eq(conversationParticipants.principalId, actualSenderId),
              ),
            )
            .limit(1)
        : [];
      if (!participantRow || !actualSenderId) return answer("from_mismatch");
      senderId = actualSenderId;
    }

    const now = new Date();
    const isSpamThread = Boolean(thread && thread.endReason === "spam");
    let spawnFollowUpFrom: ConversationId | null = null;
    let activeThread = thread;
    if (
      thread &&
      thread.status === "closed" &&
      !isSpamThread &&
      !automated.isAutomated
    ) {
      const policy = await readReopenPolicy(db);
      const closedAt =
        thread.resolvedAt ?? thread.updatedAt ?? thread.lastMessageAt;
      const outsideWindow =
        policy.mode === "never_link_new" ||
        (policy.mode === "within_days" &&
          closedAt !== null &&
          now.getTime() - closedAt.getTime() >
            policy.windowDays * 24 * 60 * 60 * 1000);
      if (outsideWindow) {
        spawnFollowUpFrom = thread.id;
        activeThread = undefined;
      }
    }

    const conversation =
      activeThread ??
      (
        await db
          .insert(conversations)
          .values({
            visitorPrincipalId: requesterId,
            channel: "email",
            source: "email",
            subject:
              (spawnFollowUpFrom && effectiveSubject
                ? `Follow-up: ${effectiveSubject}`
                : effectiveSubject
              )?.slice(0, 500) || null,
            visitorEmail: effectiveRequester.address,
            waitingSince: now,
            forwardParseFailed: Boolean(forwardParsed?.parseFailed),
          })
          .returning(threadColumns)
      )[0]!;

    if (spawnFollowUpFrom) {
      await db.insert(conversationMessages).values({
        conversationId: conversation.id,
        senderType: "system",
        isInternal: true,
        content: `Follow-up to closed conversation ${spawnFollowUpFrom}.`,
        metadata: {
          systemKind: "follow_up_created",
          previousConversationId: spawnFollowUpFrom,
        },
      });
    }

    // Register any uploaded inbound email files (#326)
    const cidToFileId = new Map<string, string>();
    const storageKeyToFileId = new Map<string, string>();
    const insertedFiles: {
      id: string;
      name: string;
      contentType: string;
      size: number;
      family: ReturnType<typeof fileFamily>;
      inline: boolean;
      contentId: string | null;
    }[] = [];

    for (const stored of called?.storedFiles ?? []) {
      const family = fileFamily(stored.contentType);
      const [fileRow] = await db
        .insert(files)
        .values({
          storageKey: stored.storageKey,
          name: stored.name,
          contentType: stored.contentType,
          declaredType: stored.contentType,
          family,
          size: stored.size,
          sha256: stored.sha256,
          source: "email",
          uploadedById: senderId,
          previewStatus: "none",
          attachedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: files.id });
      const fileId = fileRow?.id;
      if (!fileId) continue;
      storageKeyToFileId.set(stored.storageKey, fileId);
      if (stored.contentId) cidToFileId.set(stored.contentId, fileId);
      insertedFiles.push({
        id: fileId,
        name: stored.name,
        contentType: stored.contentType,
        size: stored.size,
        family,
        inline: stored.inline,
        contentId: stored.contentId,
      });
    }

    // Rewrite cid: and base64 placeholders in sanitized HTML to quills-file://<fileId> (#326)
    let resolvedHtml = rawHtml;
    if (resolvedHtml) {
      if (cidToFileId.size > 0) {
        resolvedHtml = rewriteCidToQuillsFiles(resolvedHtml, cidToFileId).html;
      }
      for (const item of called?.dataImagePlaceholders ?? []) {
        const fid = storageKeyToFileId.get(item.storageKey);
        if (fid) {
          resolvedHtml = resolvedHtml.replaceAll(
            item.placeholder,
            `quills-file://${fid}`,
          );
        }
      }
    }

    const messageContent = effectiveBody;
    const messageAttachments = insertedFiles.map((f) => ({
      url: `quills-file://${f.id}`,
      name: f.name,
      contentType: f.contentType,
      size: f.size,
      fileId: f.id,
      family: f.family,
      ...(f.inline ? { inline: true } : {}),
      ...(f.contentId ? { contentId: f.contentId } : {}),
    }));

    const ccMailboxes = forwardParsed
      ? forwardParsed.cc
      : parseMailboxList(ccHeaderValues);
    const inboundAddresses = new Set(
      (data.to ?? [])
        .map((a) => mailbox(a)?.address)
        .filter((a): a is string => Boolean(a)),
    );
    const filteredCc = ccMailboxes.filter(
      (c) =>
        c.address !== effectiveRequester.address &&
        c.address !== sender.address &&
        !inboundAddresses.has(c.address),
    );

    const [message] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        principalId: senderId,
        senderType: "visitor",
        content: messageContent,
        attachments: messageAttachments,
        metadata: {
          source: "email",
          ...(emailMessageId && { emailMessageId }),
          ...(emailAuth && { emailAuth }),
          ...(resolvedHtml &&
            !(forwardParsed?.isForward && forwardParsed.preamble.trim()) && {
              htmlBody: resolvedHtml.slice(0, 50_000),
            }),
          ...(filteredCc.length > 0 && {
            cc: filteredCc.map((c) => c.address),
          }),
          ...(forwardParsed?.isForward && {
            forwardedByEmail: sender.address,
            forwardFormat: forwardParsed.format,
          }),
          ...((automated.isAutomated || automated.suppressAutoAck) && {
            automated: true,
            automatedReason: automated.reason,
          }),
        },
      })
      .onConflictDoNothing()
      .returning({
        id: conversationMessages.id,
        createdAt: conversationMessages.createdAt,
      });

    if (!message) {
      if (!activeThread)
        throw new HTTPException(409, {
          message: "A copy of this mail is being stored",
        });
      return answer("duplicate");
    }

    // Bind inserted file rows to the persisted message
    if (insertedFiles.length > 0) {
      await db
        .update(files)
        .set({ messageId: message.id, attachedAt: message.createdAt })
        .where(
          and(
            inArray(
              files.id,
              insertedFiles.map((f) => f.id as typeof files.$inferSelect.id),
            ),
            isNull(files.deletedAt),
          ),
        );
    }

    // Preserve CC recipients in conversation_participants so replies include them & they can reply (#325)
    for (const ccPerson of filteredCc.slice(0, 15)) {
      const ccPrincipal = await senderPrincipal(db, ccPerson);
      if (ccPrincipal && ccPrincipal !== conversation.visitorPrincipalId) {
        await db
          .insert(conversationParticipants)
          .values({
            conversationId: conversation.id,
            principalId: ccPrincipal,
          })
          .onConflictDoNothing();
      }
    }

    // For a teammate forward (#325): add the forwarder to conversation_followers and save preamble as an internal note
    if (forwardParsed?.isForward && called?.teammate) {
      const forwarderPrincipal = await teammatePrincipal(db, called.teammate);
      await db
        .insert(conversationFollowers)
        .values({
          conversationId: conversation.id,
          principalId: forwarderPrincipal,
          addedByPrincipalId: forwarderPrincipal,
        })
        .onConflictDoNothing();

      if (forwardParsed.preamble.trim()) {
        await db.insert(conversationMessages).values({
          conversationId: conversation.id,
          principalId: forwarderPrincipal,
          senderType: "agent",
          isInternal: true,
          content: forwardParsed.preamble.trim().slice(0, 10_000),
          metadata: {
            source: "email_forward_preamble",
          },
        });
      }
    }

    // Spam-ended or automated (OOO/bounce) mail never reopens a closed conversation (#311)
    const shouldStayClosed =
      isSpamThread ||
      Boolean(
        activeThread &&
        activeThread.status === "closed" &&
        automated.isAutomated,
      );
    const nextStatus = shouldStayClosed
      ? ("closed" as const)
      : ("open" as const);
    await db
      .update(conversations)
      .set({
        status: nextStatus,
        ...(shouldStayClosed
          ? {}
          : {
              snoozedUntil: null,
              ...reopened(
                conversation as Parameters<typeof reopened>[0],
                nextStatus,
              ),
              solutionOfferedAt: null,
              autoCloseAt: null,
              closeReminderSentAt: null,
              waitingSince: conversation.waitingSince ?? message.createdAt,
              resolvedAt: null,
              archivedAt: null,
            }),
        lastMessageAt: message.createdAt,
        lastMessagePreview: preview(messageContent),
        updatedAt: message.createdAt,
      })
      .where(eq(conversations.id, conversation.id));

    return { status: "received" as const, messageId: message.id };
  },
});

export default apiRouter().openapi(...inbound);
