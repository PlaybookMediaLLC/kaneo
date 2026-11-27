import { createHmac, randomUUID } from "node:crypto";
import { changeSchema } from "../events";
import {
  decryptSecret,
  encryptSecret,
} from "../../notification-preferences/secrets";
import { resolveFileSecret } from "../../utils/file-secret";
import {
  OutboundRequestError,
  sendOutboundRequest,
} from "../../utils/outbound-request";

// Trusted for Quills route modules: no database access.
// Reuses the instance webhook checks: a public HTTPS target after DNS resolution, and an encrypted signing secret.
export { newSigningSecret } from "../../admin/webhooks/new-signing-secret";
export { validateWebhookUrl } from "../../admin/webhooks/validate-webhook-url";

/** Encrypts a token with AES-256-GCM when NOTIFICATION_SECRET_ENCRYPTION_KEY is configured, else returns null. */
export function encryptOptionalSecret(plaintext: string): string | null {
  if (!resolveFileSecret("NOTIFICATION_SECRET_ENCRYPTION_KEY")?.trim()) {
    return null;
  }
  return encryptSecret(plaintext) ?? null;
}

/**
 * Sends a single signed synthetic `webhook.test` payload outside any database transaction (#330).
 * Always enforces SSRF public-destination checks and caps response snippet at 2 KB.
 */
export async function sendTestWebhook(hook: {
  id: string;
  url: string;
  secret: string;
}): Promise<{
  eventId: string;
  ok: boolean;
  httpStatus: number | null;
  durationMs: number;
  responseSnippet: string | null;
  error: string | null;
}> {
  const startedAt = Date.now();
  const eventId = `test_${randomUUID()}`;
  let plainSecret: string | null = null;
  try {
    plainSecret = decryptSecret(hook.secret) ?? null;
  } catch {
    plainSecret = null;
  }
  if (!plainSecret) {
    return {
      eventId,
      ok: false,
      httpStatus: null,
      durationMs: Date.now() - startedAt,
      responseSnippet: null,
      error: "Signing secret unavailable",
    };
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    id: eventId,
    type: "webhook.test",
    createdAt: new Date().toISOString(),
    data: {
      entityType: "webhook",
      entityId: hook.id,
      test: "true",
    },
  });
  const signature = `sha256=${createHmac("sha256", plainSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex")}`;
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
          "x-kaneo-event": "webhook.test",
          "x-kaneo-delivery": `webhook:test:${eventId}`,
        },
      },
      { publicDestination: true, timeoutMs: 5_000, readSnippetBytes: 2048 },
    )) as { status?: number; snippet?: string } | undefined;
    return {
      eventId,
      ok: true,
      httpStatus: res?.status ?? 200,
      durationMs: Date.now() - startedAt,
      responseSnippet: res?.snippet?.slice(0, 2048) ?? "",
      error: null,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    if (err instanceof OutboundRequestError) {
      return {
        eventId,
        ok: false,
        httpStatus: err.status ?? null,
        durationMs,
        responseSnippet: err.snippet?.slice(0, 2048) ?? null,
        error: err.message,
      };
    }
    return {
      eventId,
      ok: false,
      httpStatus: null,
      durationMs,
      responseSnippet: null,
      error: "Webhook test delivery failed",
    };
  }
}

/** Internal-only events that external webhooks may not subscribe to. */
const INTERNAL_WEBHOOK_EXCLUDED = new Set<string>([
  "webhook.failing",
  "notification.digest_sent",
]);

/** The event catalogue a webhook may subscribe to. */
export const webhookEvent = changeSchema.shape.type.refine(
  (eventType) => !INTERNAL_WEBHOOK_EXCLUDED.has(eventType),
  "Event is internal and cannot be subscribed to by webhooks",
);
