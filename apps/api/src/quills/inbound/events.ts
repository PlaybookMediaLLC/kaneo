import { and, eq } from "drizzle-orm";
import { apiRouter, z } from "../../openapi";
import { emailLog } from "../../database/quills/schema/email-log";
import { defineQuillsRoute } from "../framework/define-route";
import { resendEvents } from "../framework/signed";

// POST /quills-public/signed/chat/email/events: Resend delivery events for mail this instance sent.
// framework/signed.ts checks the Svix signature and reads the workspace and `email_log` row from
// the mail's own tags, which the mail worker wrote and signed at send time. A bounce or complaint
// marks that row; other event types are acknowledged and change nothing.

const STATUS = {
  "email.bounced": "bounced",
  "email.complained": "complaint",
} as const;
// The tags were read and verified from the signed bytes before the transaction (`resendEvents`).
const delivery = z.object({ type: z.string().max(64) });

const events = defineQuillsRoute({
  audience: "signed",
  verifier: resendEvents,
  method: "post",
  path: "/chat/email/events",
  operationId: "receiveQuillsEmailDeliveryEvent",
  summary: "Record a delivery event for a sent mail (Resend webhook)",
  description:
    "404 until EMAIL_EVENTS_SIGNING_SECRET (or EMAIL_INBOUND_SIGNING_SECRET) is set, and for a mail that carries no signed workspace tags. email.bounced and email.complained mark the mail's log row.",
  action: "update",
  body: delivery,
  response: z.object({ status: z.enum(["recorded", "ignored", "duplicate"]) }),
  responseDescription:
    "Whether the event changed the mail's log row. Every verified event is acknowledged.",
  replay: { status: "duplicate" },
  event: {
    none: "Marks the email log row only; the recent email log reads it on request.",
  },
  handler: async ({ db, body, credential }) => {
    const status = STATUS[body.type as keyof typeof STATUS];
    const logId = (credential as { logId?: string } | undefined)?.logId;
    if (!status || !logId) return { status: "ignored" as const };
    const changed = await db
      .update(emailLog)
      .set({ status, error: status })
      .where(
        and(
          eq(emailLog.id, logId as typeof emailLog.$inferSelect.id),
          eq(emailLog.direction, "outbound"),
        ),
      )
      .returning({ id: emailLog.id });
    return { status: changed.length ? "recorded" : "ignored" } as const;
  },
});

export default apiRouter().openapi(...events);
