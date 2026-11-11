import { eq } from "drizzle-orm";
import { z } from "zod";
import { createId } from "@kaneo/ids";
import { typeIdSchema } from "@kaneo/ids/zod";
import {
  withEmailIdempotencyKey,
  withEmailTags,
  type EmailResult,
} from "@kaneo/email/quills";
import { withQuillsSystemWorkspace } from "../../../database/quills/client";
import { principal } from "../../../database/quills/schema/auth";
import { emailLog } from "../../../database/quills/schema/email-log";
import type { JobQueueRow } from "../../../database/quills/schema/job-queue";
import { mailTags } from "../../framework/signed";
import { quillsReaders } from "../../framework/platform-reads";
import { loadEvent, subscribers } from "../fanout";
import { claimDelivery, settleDelivery } from "../ledger";
import { wants } from "../preferences";
import { finishQuillsJob } from "../queue";
import { customerPostAddress } from "./support-mail";

type EmailLogRow = typeof emailLog.$inferInsert;

export const mailPayloadSchema = z
  .object({
    eventId: z.string().min(1).max(200),
    /** Absent for direct mail: the event's content names the one address (an invite). */
    principalId: typeIdSchema("principal").optional(),
    /** A copy job: the message whose customer this mail reaches (a tracker's reply-all copy). */
    messageId: typeIdSchema("conversation_msg").optional(),
  })
  .strict();

const UNCERTAIN = "Mail outcome uncertain; not sent again";

/**
 * A send error that proves nothing was accepted, or undefined when the message may have been accepted.
 * SMTP errors carry the server's reply code; Resend and SES errors carry the provider's HTTP status.
 */
export function rejection(error: unknown) {
  const { name, retryable, responseCode, status } = (error ?? {}) as {
    name?: unknown;
    retryable?: unknown;
    responseCode?: unknown;
    status?: unknown;
  };
  if (name === "SendRateQueueFullError")
    return { error: "Send rate limit reached", permanent: false };
  if (typeof responseCode === "number")
    return { error: `SMTP ${responseCode}`, permanent: responseCode >= 500 };
  if (typeof status === "number" && status < 500)
    return {
      error: `Mail provider HTTP ${status}`,
      permanent: status !== 408 && status !== 429,
    };
  // A provider 5xx or a failure with no answer can follow an accepted message.
  if (typeof status === "number" || retryable !== false) return undefined;
  return {
    error: /^Email(Config|ProviderConflict)Error$/.test(String(name))
      ? "Mail is not configured"
      : "Mail provider refused the message",
    permanent: true,
  };
}

export async function runMailJob(workspaceId: string, job: JobQueueRow) {
  const { eventId, principalId, messageId } = mailPayloadSchema.parse(
    job.payload,
  );
  const finish = (error?: string, permanent?: boolean) =>
    withQuillsSystemWorkspace(workspaceId, (db) =>
      finishQuillsJob(db, job.id, job.leaseToken!, error, permanent),
    );
  const prepared = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const event = await loadEvent(db, eventId);
    const entry = event && subscribers[event.type];
    if (!entry) return undefined;
    // A copy job mails a message that the entry still names as this event's copy.
    if (messageId) {
      if (
        principalId ||
        !(await entry.copies?.(db, event, messageId))?.includes(messageId)
      )
        return undefined;
      const content = await entry.mail?.(db, event, null, messageId);
      return content?.to
        ? { content, to: content.to, userId: null, customer: null }
        : undefined;
    }
    // A direct entry mails only the address its content names; a principal entry never does.
    if (Boolean(entry.direct) === Boolean(principalId)) return undefined;
    const content = await entry.mail?.(db, event, principalId ?? null);
    if (!content) return undefined;
    if (!principalId)
      return content.to
        ? { content, to: content.to, userId: null, customer: null }
        : undefined;
    if (!(await wants(db, principalId, content.type, "email")))
      return undefined;
    const [recipient] = await db
      .select({ userId: principal.kaneoUserId })
      .from(principal)
      .where(eq(principal.id, principalId));
    if (recipient?.userId)
      return { content, to: null, userId: recipient.userId, customer: null };
    // A customer recipient only for an entry that mails customers.
    return recipient && entry.customers
      ? { content, to: null, userId: null, customer: principalId }
      : undefined;
  });
  if (!prepared) return finish();
  // Membership and address are read at send time: a teammate who left or lost access gets nothing,
  // and a customer gets mail only while the portal or widget still shows them the post.
  const customerEmail = prepared.customer
    ? prepared.content.customerAddress
      ? await prepared.content.customerAddress(workspaceId, prepared.customer)
      : await customerPostAddress(
          workspaceId,
          prepared.customer,
          prepared.content.postId,
          prepared.content.commentId,
        )
    : undefined;
  const reader = prepared.userId
    ? (await quillsReaders(workspaceId, [prepared.userId])).get(prepared.userId)
    : prepared.customer
      ? customerEmail && { email: customerEmail }
      : prepared.to && { email: prepared.to };
  if (!reader) return finish();
  const key =
    prepared.content.ledgerKey ??
    `mail:${eventId}:${messageId ?? principalId ?? "direct"}`;
  const claim = await withQuillsSystemWorkspace(workspaceId, (db) =>
    claimDelivery(db, key, "mail"),
  );
  if (claim === "completed") return finish();
  if (claim === "uncertain") return finish(UNCERTAIN, true);

  let result: EmailResult | undefined;
  let failure: { error: string; permanent: boolean } | undefined;
  let uncertain = false;
  // The provider returns these tags with its delivery events (inbound/events.ts): the workspace
  // and the log row come from our own signed send, never from the event's caller.
  const logId = createId("email_log");
  try {
    // The provider also sees one idempotency key for every attempt of this send.
    result = await withEmailIdempotencyKey(key, () =>
      withEmailTags(mailTags(workspaceId, logId), () =>
        prepared.content.send(reader.email),
      ),
    );
  } catch (error) {
    failure = rejection(error);
    uncertain = !failure;
  }
  const outcome = uncertain ? "uncertain" : failure ? "failed" : "completed";
  // Its own transaction, so a lease lost later cannot erase what happened.
  await withQuillsSystemWorkspace(workspaceId, async (db) => {
    await settleDelivery(db, key, outcome);
    await db.insert(emailLog).values({
      id: logId,
      direction: "outbound",
      emailType: prepared.content.emailType,
      principalId: principalId ?? null,
      address: reader.email,
      postId: prepared.content.postId ?? null,
      conversationId:
        (prepared.content.conversationId as EmailLogRow["conversationId"]) ??
        null,
      status:
        outcome === "completed" ? (result?.sent ? "sent" : "skipped") : outcome,
      error: uncertain ? UNCERTAIN : (failure?.error ?? null),
    });
  });
  if (uncertain) return finish(UNCERTAIN, true);
  return finish(failure?.error, failure?.permanent);
}
