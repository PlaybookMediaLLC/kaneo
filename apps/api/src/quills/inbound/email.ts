import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z } from "../../openapi";
import {
  principal,
  settings,
  user as customer,
} from "../../database/quills/schema/auth";
import { contactIdentities } from "../../database/quills/schema/contact-identities";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { looksLikeSpam } from "../feedback/content-checks";
import { isSpamBlocked, isTrustedSender } from "../framework/anti-spam";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import {
  ownMessageIds,
  receivedEmailText,
  replyAddressConversation,
  replyAddressPost,
  resendInbound,
} from "../framework/signed";
import { commentByMail } from "./post-reply";
import { preview } from "../support/conversation-model";
import { trustedEmailAuth } from "./email-auth";
import { reopened } from "../support/conversation-ops";

// POST /quills-public/signed/chat/email/inbound: mail that Resend received for a workspace address
// on EMAIL_INBOUND_DOMAIN (`<workspace slug>@domain` or `<slug>+tag@domain`). framework/signed.ts
// checks the Svix signature and names the workspace that owns the address. A reply from the same
// sender appends to its conversation: one sent to the conversation's signed reply address
// (`<workspace ID>+c<conversation><tag>@domain`, the Reply-To of our mail), or one whose
// In-Reply-To or References names an earlier inbound mail or one of our replies. Other mail opens
// an email conversation for the sender's customer profile. A repeated Message-ID or delivery
// changes nothing.

type ConversationId = (typeof conversations.$inferSelect)["id"];
type MessageId = (typeof conversationMessages.$inferSelect)["id"];

const MAX_REFERENCES = 20;
// Generous bounds: the body is at most 1 MiB, and a refused mail is lost after the provider retries.
const header = z.string().max(100_000);
const received = z.object({
  type: z.string().max(64),
  data: z
    .object({
      email_id: z.string().max(200).optional(),
      from: z.string().max(998).optional(),
      to: z.array(z.string().max(998)).max(1000).optional(),
      subject: z.string().max(998).optional(),
      text: z.string().max(100_000).optional(),
      message_id: z.string().max(998).optional(),
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

/** Every value of a header from Resend's map or list form, in order, by case-insensitive name. */
function readHeaders(data: Received, name: string) {
  const headers = data.headers;
  if (!headers) return [];
  const entries = Array.isArray(headers)
    ? headers.map((entry) => [entry.name, entry.value] as const)
    : Object.entries(headers);
  return entries
    .filter(([key]) => key.toLowerCase() === name)
    .map(([, value]) => value);
}
const readHeader = (data: Received, name: string) => readHeaders(data, name)[0];
/** `Name <a@b.c>` or `a@b.c`, lower-cased. Null when it is not one plain address. */
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

/** Follow a merged tombstone chain (bounded) to the surviving contact principal. */
async function resolveSurvivingPrincipal(
  db: Database,
  principalId: (typeof principal.$inferSelect)["id"],
) {
  let currentId = principalId;
  for (let hop = 0; hop < 5; hop++) {
    const [row] = await db
      .select({
        id: principal.id,
        blockedAt: principal.blockedAt,
        mergedInto: principal.mergedIntoPrincipalId,
      })
      .from(principal)
      .where(eq(principal.id, currentId))
      .limit(1);
    if (!row) return null;
    if (!row.mergedInto) return row.blockedAt ? null : row.id;
    currentId = row.mergedInto;
  }
  return null;
}

/** The sender's customer profile and principal, created on first mail. Null when it is blocked. */
async function senderPrincipal(
  db: Database,
  sender: { address: string; name: string },
) {
  // Multi-identity resolution (#310): check secondary/merged emails in contact_identities first.
  const [linked] = await db
    .select({ principalId: contactIdentities.principalId })
    .from(contactIdentities)
    .where(
      and(
        eq(contactIdentities.kind, "email"),
        sql`lower(${contactIdentities.value}) = ${sender.address}`,
      ),
    )
    .limit(1);
  if (linked) {
    return resolveSurvivingPrincipal(db, linked.principalId);
  }
  // Chat-to-email continuation (#319): anonymous widget visitors store verified email on principal.contactEmail.
  const [byContactEmail] = await db
    .select({ id: principal.id })
    .from(principal)
    .where(
      and(
        sql`lower(${principal.contactEmail}) = ${sender.address}`,
        isNull(principal.mergedIntoPrincipalId),
      ),
    )
    .limit(1);
  if (byContactEmail) {
    return resolveSurvivingPrincipal(db, byContactEmail.id);
  }
  const find = async () =>
    (
      await db
        .select({ id: customer.id })
        .from(customer)
        .where(sql`lower(${customer.email}) = ${sender.address}`)
        .limit(1)
    )[0];
  // A From address is not proof of identity: the profile stays unverified.
  if (!(await find()))
    // user_email_idx: a concurrent first mail from the same address creates it once.
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
    .select({ id: principal.id })
    .from(principal)
    .where(eq(principal.userId, identity.id))
    .limit(1);
  return person ? resolveSurvivingPrincipal(db, person.id) : null;
}

const inbound = defineQuillsRoute({
  audience: "signed",
  verifier: resendInbound,
  method: "post",
  path: "/chat/email/inbound",
  operationId: "receiveQuillsInboundEmail",
  summary: "Receive a mail for a workspace address (Resend inbound webhook)",
  description:
    "404 until EMAIL_INBOUND_SIGNING_SECRET and EMAIL_INBOUND_DOMAIN are set. The body is fetched from Resend when the event carries none (EMAIL_RESEND_API_KEY).",
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
  prepare: async ({ body }) => ({
    emailId:
      body.type === "email.received" && !body.data.text
        ? (body.data.email_id ?? null)
        : null,
  }),
  // No transaction is open: the Resend API call.
  call: ({ emailId }) =>
    emailId ? receivedEmailText(emailId) : Promise.resolve(null),
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
    // Email-domain blocklist (#320) runs before creating any customer row or conversation.
    if ((await isSpamBlocked(db, { email: sender.address })).blocked) {
      return answer("blocked");
    }
    const content = (called ?? data.text ?? "").trim().slice(0, 10_000);
    if (!content) return answer("empty");
    const emailMessageId = (
      messageIds(readHeader(data, "message-id"))[0] ??
      data.message_id ??
      data.email_id
    )?.slice(0, 998);
    // A reply to a post notification becomes the subscriber's comment (inbound/post-reply.ts).
    const postId = replyAddressPost(data.to ?? [], workspaceId);
    if (postId) {
      const reply = await commentByMail(db, {
        postId: postId as never,
        address: sender.address,
        text: content,
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
    const visitor = await senderPrincipal(db, sender);
    if (!visitor) return answer("blocked");
    if ((await isSpamBlocked(db, { principalId: visitor })).blocked) {
      return answer("blocked");
    }
    // Only the list form keeps every header in order; a map keeps one copy, maybe the sender's.
    const emailAuth = Array.isArray(data.headers)
      ? trustedEmailAuth(
          readHeaders(data, "authentication-results"),
          process.env.EMAIL_INBOUND_AUTHSERV_ID ?? "",
        )
      : null;
    const references = [
      ...messageIds(readHeader(data, "in-reply-to")),
      ...messageIds(readHeader(data, "references")),
    ].slice(0, MAX_REFERENCES);
    const threadColumns = {
      id: conversations.id,
      status: conversations.status,
      endReason: conversations.endReason,
      resolvedAt: conversations.resolvedAt,
      mergedIntoConversationId: conversations.mergedIntoConversationId,
      visitorPrincipalId: conversations.visitorPrincipalId,
      waitingSince: conversations.waitingSince,
    };
    // The signed reply address of an email or messenger conversation first (#319): routes without any header.
    const addressed = replyAddressConversation(data.to ?? [], workspaceId);
    const [byAddress] = addressed
      ? await db
          .select(threadColumns)
          .from(conversations)
          .where(
            and(
              eq(conversations.id, addressed as ConversationId),
              inArray(conversations.channel, ["email", "messenger"]),
            ),
          )
          .for("update")
      : [];
    // Then In-Reply-To and References: an earlier inbound mail's Message-ID, or ours on a reply.
    const ours = ownMessageIds(references) as MessageId[];
    let [thread] = byAddress
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
                inArray(conversations.channel, ["email", "messenger"]),
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
    // Follow merged conversations (#322) so customer replies land on the surviving thread.
    for (let hop = 0; hop < 5 && thread?.mergedIntoConversationId; hop++) {
      const [surviving] = await db
        .select(threadColumns)
        .from(conversations)
        .where(eq(conversations.id, thread.mergedIntoConversationId))
        .limit(1)
        .for("update");
      if (!surviving) break;
      thread = surviving;
    }
    // A reply from another address never joins someone else's thread.
    if (thread && thread.visitorPrincipalId !== visitor)
      return answer("from_mismatch");
    const now = new Date();
    const [spamCfg] = !thread
      ? await db
          .select({ spamFilterConfig: settings.spamFilterConfig })
          .from(settings)
          .limit(1)
      : [];
    const quarantined =
      !thread &&
      !isTrustedSender(spamCfg?.spamFilterConfig, sender.address) &&
      looksLikeSpam(`${data.subject ?? ""}\n${content}`);
    const conversation =
      thread ??
      (
        await db
          .insert(conversations)
          .values({
            visitorPrincipalId: visitor,
            channel: "email",
            source: "email",
            status: quarantined ? "closed" : "open",
            ...(quarantined && {
              endReason: "spam",
              spamReason: "heuristic",
              resolvedAt: now,
            }),
            subject: data.subject?.slice(0, 500) || null,
            visitorEmail: sender.address,
            waitingSince: now,
          })
          .returning(threadColumns)
      )[0]!;
    const [message] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        principalId: visitor,
        senderType: "visitor",
        content,
        metadata: {
          source: "email",
          ...(emailMessageId && { emailMessageId }),
          ...(emailAuth && { emailAuth }),
        },
      })
      // conversation_messages_email_message_id_idx: a concurrent copy of the same mail.
      .onConflictDoNothing()
      .returning({
        id: conversationMessages.id,
        createdAt: conversationMessages.createdAt,
      });
    if (!message) {
      // A concurrent copy stored this mail first. Roll back the conversation that this copy opened;
      // the provider retries and then finds the mail.
      if (!thread)
        throw new HTTPException(409, {
          message: "A copy of this mail is being stored",
        });
      return answer("duplicate");
    }
    // A customer reply reopens a closed conversation, except one ended as spam.
    const isSpam = quarantined || conversation.endReason === "spam";
    const status = isSpam ? ("closed" as const) : ("open" as const);
    await db
      .update(conversations)
      .set({
        status,
        snoozedUntil: null,
        // reopened() reads only the status.
        ...(isSpam
          ? {}
          : reopened(conversation as Parameters<typeof reopened>[0], status)),
        lastMessageAt: message.createdAt,
        lastMessagePreview: preview(content),
        waitingSince: conversation.waitingSince ?? message.createdAt,
        resolvedAt: isSpam ? (conversation.resolvedAt ?? now) : null,
        // A customer message brings an archived conversation back to the inbox.
        archivedAt: null,
        updatedAt: message.createdAt,
      })
      .where(eq(conversations.id, conversation.id));
    return { status: "received" as const, messageId: message.id };
  },
});

export default apiRouter().openapi(...inbound);
