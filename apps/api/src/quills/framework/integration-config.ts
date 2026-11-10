import { HTTPException } from "hono/http-exception";
import { encryptSecret } from "../../notification-preferences/secrets";
import { withoutOutboundTelemetry } from "../../utils/sensitive-outbound";

// Trusted for Quills route modules: no database access and no event delivery.
// Seals provider credentials with the instance key, and runs one bounded read (GET) to a fixed provider API host.
export { validateWebhookUrl } from "../../admin/webhooks/validate-webhook-url";

/** A credential as a provider accepts it in a header: printable ASCII, so a pasted invisible character gives 400. */
export const credentialText = /^[\x21-\x7e]+$/;

/** Encrypts provider credentials as one JSON value. 409 before any outbound call when the key is missing. */
export function sealCredentials(values: Record<string, string>) {
  if (!process.env.NOTIFICATION_SECRET_ENCRYPTION_KEY?.trim())
    throw new HTTPException(409, {
      message:
        "Set NOTIFICATION_SECRET_ENCRYPTION_KEY to connect an integration.",
    });
  return encryptSecret(JSON.stringify(values))!;
}

/** The provider API hosts a request may reach. A Freshdesk subdomain is one DNS label. */
const PROVIDER_HOST =
  /^(api\.stripe\.com|api\.app\.shortcut\.com|[a-z0-9-]{1,63}\.freshdesk\.com)$/;

/**
 * A credential check for a save route: one GET to a fixed provider API host, with no redirect and no retry.
 * It returns the provider's JSON answer. Provider text never reaches the caller.
 */
export async function checkProviderCredentials(
  url: string,
  headers: Record<string, string>,
): Promise<Record<string, unknown>> {
  const target = new URL(url);
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    !PROVIDER_HOST.test(target.hostname)
  )
    throw new Error("Provider host not allowed");
  let response: Response;
  try {
    // Credentials travel in headers; keep the request out of automatic HTTP telemetry.
    response = await withoutOutboundTelemetry(() =>
      fetch(target, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      }),
    );
  } catch {
    throw new HTTPException(502, {
      message: "The provider could not be reached. Try again.",
    });
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw response.status === 401 || response.status === 403
      ? new HTTPException(400, {
          message: "The provider rejected these credentials.",
        })
      : new HTTPException(502, {
          message: "The provider could not check these credentials. Try again.",
        });
  }
  const body: unknown = await response.json().catch(() => ({}));
  return body && typeof body === "object"
    ? (body as Record<string, unknown>)
    : {};
}
