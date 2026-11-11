import { createHmac } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { typeIdSchema } from "@kaneo/ids/zod";
import { withQuillsSystemWorkspace } from "../../../database/quills/client";
import type { JobQueueRow } from "../../../database/quills/schema/job-queue";
import { webhooks } from "../../../database/quills/schema/webhooks";
import { decryptSecret } from "../../../notification-preferences/secrets";
import { assertPublicDestination } from "../../../utils/assert-public-destination";
import { DestinationLookupError } from "../../../utils/destination-lookup-error";
import {
  OutboundRequestError,
  sendOutboundRequest,
} from "../../../utils/outbound-request";
import { loadEvent, type DeliveryEvent } from "../fanout";
import { claimDelivery, settleDelivery } from "../ledger";
import { finishQuillsJob } from "../queue";

export const webhookPayloadSchema = z
  .object({
    eventId: z.string().min(1).max(200),
    webhookId: typeIdSchema("webhook"),
  })
  .strict();

const UNCERTAIN = "Webhook outcome uncertain; not sent again";
type Attempt = {
  outcome: "completed" | "failed" | "uncertain";
  error?: string;
  permanent?: boolean;
};

/** The JSON body and its signature: HMAC-SHA256 of `${timestamp}.${body}` with the webhook secret. */
export function signedWebhook(
  event: DeliveryEvent,
  secret: string,
  timestamp: string,
) {
  const body = JSON.stringify({
    id: event.eventId,
    type: event.type,
    createdAt: event.occurredAt.toISOString(),
    data: {
      ...(event.payload as Record<string, string>),
      entityType: event.entityType,
      entityId: event.entityId,
    },
  });
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return { body, signature: `sha256=${signature}` };
}

async function send(
  hook: { url: string; secret: string },
  event: DeliveryEvent,
  key: string,
): Promise<Attempt> {
  let secret: string | null | undefined;
  try {
    secret = decryptSecret(hook.secret);
  } catch {
    secret = undefined;
  }
  // An operator can restore the encryption key, so this failure may retry.
  if (!secret)
    return { outcome: "failed", error: "Signing secret unavailable" };
  try {
    // Checked after DNS resolution; the socket checks the resolved address again.
    await assertPublicDestination(hook.url, "Webhook");
  } catch (error) {
    return error instanceof DestinationLookupError
      ? { outcome: "failed", error: "Destination could not be resolved" }
      : {
          outcome: "failed",
          error: "Destination is not a public address",
          permanent: true,
        };
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const { body, signature } = signedWebhook(event, secret, timestamp);
  try {
    await sendOutboundRequest(
      hook.url,
      {
        body,
        headers: {
          "content-type": "application/json",
          "user-agent": "Quills-Webhook/1.0",
          "x-kaneo-timestamp": timestamp,
          "x-kaneo-signature": signature,
          "x-kaneo-event": event.type,
          "x-kaneo-delivery": key,
        },
      },
      { publicDestination: true, timeoutMs: 5_000 },
    );
    return { outcome: "completed" };
  } catch (error) {
    const reason = error instanceof OutboundRequestError ? error.reason : "";
    if (reason === "http") {
      const status = (error as OutboundRequestError).status ?? 0;
      return {
        outcome: "failed",
        error: `HTTP ${status}`,
        permanent: !(status === 408 || status === 429 || status >= 500),
      };
    }
    if (reason === "destination")
      return {
        outcome: "failed",
        error: "Destination is not a public address",
        permanent: true,
      };
    // A timeout or a broken connection can follow a request that the receiver accepted.
    // ponytail: the helper hides the cause, so a refused connection, or a DNS failure or deadline in its own
    // destination re-check, is also recorded as uncertain; classify the cause if receivers restart often.
    return { outcome: "uncertain", error: UNCERTAIN, permanent: true };
  }
}

export async function runWebhookJob(workspaceId: string, job: JobQueueRow) {
  const { eventId, webhookId } = webhookPayloadSchema.parse(job.payload);
  const key = `webhook:${eventId}:${webhookId}`;
  const finish = (error?: string, permanent?: boolean) =>
    withQuillsSystemWorkspace(workspaceId, (db) =>
      finishQuillsJob(db, job.id, job.leaseToken!, error, permanent),
    );
  const prepared = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const event = await loadEvent(db, eventId);
    // The live row decides, so a webhook disabled, deleted, re-pointed or rotated after fan-out is honored.
    const [hook] = await db
      .select({
        url: webhooks.url,
        secret: webhooks.secret,
        events: webhooks.events,
      })
      .from(webhooks)
      .where(
        and(
          eq(webhooks.id, webhookId),
          eq(webhooks.status, "active"),
          isNull(webhooks.deletedAt),
        ),
      );
    if (!event || !hook?.events.includes(event.type)) return undefined;
    return { event, hook, claim: await claimDelivery(db, key, "webhook") };
  });
  if (!prepared || prepared.claim === "completed") return finish();
  if (prepared.claim === "uncertain") return finish(UNCERTAIN, true);
  const attempt = await send(prepared.hook, prepared.event, key);
  // Its own transaction, so a lease lost later cannot erase what happened.
  await withQuillsSystemWorkspace(workspaceId, async (db) => {
    await settleDelivery(db, key, attempt.outcome);
    await db
      .update(webhooks)
      .set(
        attempt.outcome === "completed"
          ? { failureCount: 0, lastError: null, lastTriggeredAt: new Date() }
          : {
              failureCount: sql`${webhooks.failureCount}+1`,
              lastError: attempt.error,
              lastTriggeredAt: new Date(),
            },
      )
      .where(eq(webhooks.id, webhookId));
  });
  return finish(attempt.error, attempt.permanent);
}
