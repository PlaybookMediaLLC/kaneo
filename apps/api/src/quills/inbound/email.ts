import { and, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z } from "../../openapi";
import { principal, user as customer } from "../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { receivedEmailText, resendInbound } from "../framework/signed";
import { preview } from "../support/conversation-model";
import { reopened } from "../support/conversation-ops";

// POST /quills-public/signed/chat/email/inbound: mail that Resend received for a workspace address
// on EMAIL_INBOUND_DOMAIN (`<workspace slug>@domain` or `<slug>+tag@domain`). framework/signed.ts
// checks the Svix signature and names the workspace that owns the address. A reply (In-Reply-To or
// References naming an earlier inbound message) from the same sender appends to its conversation;
// other mail opens an email conversation for the sender's customer profile. A repeated Message-ID
// or delivery changes nothing.

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

/** A header value from Resend's map or list form, by case-insensitive name. */
function readHeader(data: Received, name: string) {
  const headers = data.headers;
  if (!headers) return undefined;
  const entries = Array.isArray(headers)
    ? headers.map((entry) => [entry.name, entry.value] as const)
    : Object.entries(headers);
  return entries.find(([key]) => key.toLowerCase() === name)?.[1];
}
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
    .select({ id: principal.id, blockedAt: principal.blockedAt })
    .from(principal)
    .where(eq(principal.userId, identity.id))
    .limit(1);
  return person && !person.blockedAt ? person.id : null;
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
    result.messageId !== null && {
      type: "conversation.email_received",
      entityType: "conversation_message",
      entityId: result.messageId,
    },
  handler: async ({ db, body, called }) => {
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
    const content = (called ?? data.text ?? "").trim().slice(0, 10_000);
    if (!content) return answer("empty");
    const emailMessageId = (
      messageIds(readHeader(data, "message-id"))[0] ??
      data.message_id ??
      data.email_id
    )?.slice(0, 998);
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
    const references = [
      ...messageIds(readHeader(data, "in-reply-to")),
      ...messageIds(readHeader(data, "references")),
    ].slice(0, MAX_REFERENCES);
    const [thread] = references.length
      ? await db
          .select({
            id: conversations.id,
            status: conversations.status,
            visitorPrincipalId: conversations.visitorPrincipalId,
            waitingSince: conversations.waitingSince,
          })
          .from(conversationMessages)
          .innerJoin(
            conversations,
            eq(conversations.id, conversationMessages.conversationId),
          )
          .where(
            and(
              eq(conversations.channel, "email"),
              inArray(
                sql<string>`${conversationMessages.metadata} ->> 'emailMessageId'`,
                references,
              ),
            ),
          )
          .limit(1)
          .for("update")
      : [];
    // A reply from another address never joins someone else's thread.
    if (thread && thread.visitorPrincipalId !== visitor)
      return answer("from_mismatch");
    const now = new Date();
    const conversation =
      thread ??
      (
        await db
          .insert(conversations)
          .values({
            visitorPrincipalId: visitor,
            channel: "email",
            source: "email",
            subject: data.subject?.slice(0, 500) || null,
            visitorEmail: sender.address,
            waitingSince: now,
          })
          .returning({
            id: conversations.id,
            status: conversations.status,
            visitorPrincipalId: conversations.visitorPrincipalId,
            waitingSince: conversations.waitingSince,
          })
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
    // A customer reply reopens a closed conversation; a snoozed one wakes.
    const status = "open" as const;
    await db
      .update(conversations)
      .set({
        status,
        snoozedUntil: null,
        // reopened() reads only the status.
        ...reopened(conversation as Parameters<typeof reopened>[0], status),
        lastMessageAt: message.createdAt,
        lastMessagePreview: preview(content),
        waitingSince: conversation.waitingSince ?? message.createdAt,
        resolvedAt: null,
        updatedAt: message.createdAt,
      })
      .where(eq(conversations.id, conversation.id));
    return { status: "received" as const, messageId: message.id };
  },
});

export default apiRouter().openapi(...inbound);
