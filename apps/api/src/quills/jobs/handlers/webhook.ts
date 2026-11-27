import { createHmac } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { typeIdSchema } from "@kaneo/ids/zod";
import { withQuillsSystemWorkspace } from "../../../database/quills/client";
import type { JobQueueRow } from "../../../database/quills/schema/job-queue";
import {
  webhookDeliveries,
  webhooks,
} from "../../../database/quills/schema/webhooks";
import { decryptSecret } from "../../../notification-preferences/secrets";
import { assertPublicDestination } from "../../../utils/assert-public-destination";
import { DestinationLookupError } from "../../../utils/destination-lookup-error";
import {
  OutboundRequestError,
  sendOutboundRequest,
} from "../../../utils/outbound-request";
import { recordQuillsChange } from "../../events";
import { loadEvent, type DeliveryEvent } from "../fanout";
import { claimDelivery, settleDelivery } from "../ledger";
import { finishQuillsJob } from "../queue";

export const webhookPayloadSchema = z
  .object({
    eventId: z.string().min(1).max(200),
    webhookId: typeIdSchema("webhook"),
    /** Optional unique ID for manual replays so they bypass the original delivery ledger key (#330). */
    replayId: z.string().min(1).max(100).optional(),
  })
  .strict();

const UNCERTAIN = "Webhook outcome uncertain; not sent again";
const FAILURE_ALERT_THRESHOLD = 10;
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

type Attempt = {
  outcome: "completed" | "failed" | "uncertain";
  httpStatus?: number;
  durationMs: number;
  responseSnippet?: string;
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
  const startedAt = Date.now();
  let secret: string | null | undefined;
  try {
    secret = decryptSecret(hook.secret);
  } catch {
    secret = undefined;
  }
  // An operator can restore the encryption key, so this failure may retry.
  if (!secret)
    return {
      outcome: "failed",
      durationMs: Date.now() - startedAt,
      error: "Signing secret unavailable",
    };
  try {
    // Checked after DNS resolution; the socket checks the resolved address again.
    await assertPublicDestination(hook.url, "Webhook");
  } catch (error) {
    return error instanceof DestinationLookupError
      ? {
          outcome: "failed",
          durationMs: Date.now() - startedAt,
          error: "Destination could not be resolved",
        }
      : {
          outcome: "failed",
          durationMs: Date.now() - startedAt,
          error: "Destination is not a public address",
          permanent: true,
        };
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const { body, signature } = signedWebhook(event, secret, timestamp);
  try {
    const res = (await sendOutboundRequest(
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
      { publicDestination: true, timeoutMs: 5_000, readSnippetBytes: 2048 },
    )) as { status?: number; snippet?: string } | undefined;
    return {
      outcome: "completed",
      httpStatus: res?.status ?? 200,
      durationMs: Date.now() - startedAt,
      responseSnippet: res?.snippet,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const reason = error instanceof OutboundRequestError ? error.reason : "";
    if (reason === "http") {
      const httpErr = error as OutboundRequestError;
      const status = httpErr.status ?? 0;
      return {
        outcome: "failed",
        httpStatus: status,
        durationMs,
        responseSnippet: httpErr.snippet,
        error: `HTTP ${status}`,
        permanent: !(status === 408 || status === 429 || status >= 500),
      };
    }
    if (reason === "destination")
      return {
        outcome: "failed",
        durationMs,
        error: "Destination is not a public address",
        permanent: true,
      };
    // A timeout or a broken connection can follow a request that the receiver accepted.
    return {
      outcome: "uncertain",
      durationMs,
      error: UNCERTAIN,
      permanent: true,
    };
  }
}

export async function runWebhookJob(workspaceId: string, job: JobQueueRow) {
  const { eventId, webhookId, replayId } = webhookPayloadSchema.parse(
    job.payload,
  );
  const key = replayId
    ? `webhook:${eventId}:${webhookId}:replay:${replayId}`
    : `webhook:${eventId}:${webhookId}`;
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
    // Manual replays allow re-sending an event even if event subscriptions were adjusted later.
    if (!event || !hook || (!replayId && !hook.events.includes(event.type)))
      return undefined;
    return { event, hook, claim: await claimDelivery(db, key, "webhook") };
  });
  if (!prepared || prepared.claim === "completed") return finish();
  if (prepared.claim === "uncertain") return finish(UNCERTAIN, true);

  const attempt = await send(prepared.hook, prepared.event, key);
  const willRetry = Boolean(
    attempt.error && !attempt.permanent && job.attempts < job.maxAttempts,
  );

  // Its own transaction, so a lease lost later cannot erase what happened.
  await withQuillsSystemWorkspace(workspaceId, async (db) => {
    await settleDelivery(db, key, attempt.outcome);
    const now = new Date();
    await db.insert(webhookDeliveries).values({
      webhookId,
      eventId,
      eventType: prepared.event.type,
      attempt: job.attempts,
      status:
        attempt.outcome === "completed"
          ? "succeeded"
          : willRetry
            ? "retrying"
            : "failed",
      httpStatus: attempt.httpStatus ?? null,
      durationMs: attempt.durationMs,
      responseSnippet: attempt.responseSnippet?.slice(0, 2048) ?? null,
      error: attempt.error ?? null,
      deliveredAt: attempt.outcome === "completed" ? now : null,
    });

    const [updatedHook] = await db
      .update(webhooks)
      .set(
        attempt.outcome === "completed"
          ? { failureCount: 0, lastError: null, lastTriggeredAt: now }
          : {
              failureCount: sql`${webhooks.failureCount}+1`,
              lastError: attempt.error,
              lastTriggeredAt: now,
            },
      )
      .where(eq(webhooks.id, webhookId))
      .returning({
        failureCount: webhooks.failureCount,
        lastAlertedAt: webhooks.lastAlertedAt,
      });

    // Alert workspace admins once per 24h when consecutive failures hit threshold (#330)
    if (
      attempt.outcome !== "completed" &&
      updatedHook &&
      updatedHook.failureCount >= FAILURE_ALERT_THRESHOLD
    ) {
      const canAlert =
        !updatedHook.lastAlertedAt ||
        now.getTime() - updatedHook.lastAlertedAt.getTime() >=
          ALERT_COOLDOWN_MS;
      if (canAlert) {
        await db
          .update(webhooks)
          .set({ lastAlertedAt: now })
          .where(eq(webhooks.id, webhookId));
        await recordQuillsChange(db, null, {
          type: "webhook.failing",
          entityType: "webhook",
          entityId: webhookId,
          payload: {
            failureCount: String(updatedHook.failureCount),
            lastError: (attempt.error ?? "Delivery failed").slice(0, 400),
          },
        });
      }
    }
  });
  return finish(attempt.error, attempt.permanent);
}
