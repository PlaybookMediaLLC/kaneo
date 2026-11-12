import { HTTPException } from "hono/http-exception";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from "../../notification-preferences/secrets";
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

/** Credentials sealed by `sealCredentials`, or undefined when they cannot be read (another key, damage). */
export function openCredentials(
  sealed: string | null,
): Record<string, string> | undefined {
  if (!isEncryptedSecret(sealed)) return undefined;
  try {
    const value: unknown = JSON.parse(decryptSecret(sealed) ?? "");
    return value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : undefined;
  } catch {
    return undefined;
  }
}

/** The OAuth provider hosts that a `call` step may reach. Fixed hosts: no DNS check of user input. */
const OAUTH_PROVIDER_HOST =
  /^(github\.com|api\.github\.com|gitlab\.com|slack\.com|discord\.com|api\.resend\.com)$/;

/** A provider call that did not succeed. `status` null: no answer arrived, so the outcome is unknown. */
export class ProviderCallError extends Error {
  constructor(readonly status: number | null) {
    super(status ? `Provider answered ${status}` : "Provider did not answer");
  }
}

/**
 * The largest provider answer that providerJson reads. The largest real answers are lists of 100
 * items: GitHub repositories (about 0.6 MB), Notion databases and GitHub comments (a few MB at most).
 * A larger answer is refused as a malformed one (502) before more of it is read.
 */
const MAX_ANSWER_BYTES = 10 * 1024 * 1024;

/** The JSON of an answer, read in chunks up to MAX_ANSWER_BYTES. Null when the body breaks or is not JSON. */
async function answerJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ANSWER_BYTES) {
        void reader.cancel().catch(() => {});
        throw new ProviderCallError(502);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ProviderCallError) throw error;
    return null;
  }
  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } catch {
    return null;
  }
}

/**
 * Settles with `work`, or rejects with a fixed 502 as soon as `signal` aborts. It does not wait for
 * work that ignores the abort (a stuck DNS lookup): that work ends later and its result is dropped.
 */
export function beforeDeadline<T>(
  work: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return work;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      const late = () =>
        reject(
          new HTTPException(502, {
            message: "The provider did not answer in time. Try again.",
          }),
        );
      if (signal.aborted) late();
      else signal.addEventListener("abort", late, { once: true });
    }),
  ]);
}

/**
 * One request to a fixed OAuth provider host: HTTPS, no redirect, no retry, a 10-second timeout and no
 * HTTP telemetry (tokens travel in headers). Returns the JSON answer. Provider text never reaches a caller.
 * `hosts` is the calling provider's own host pattern (integrations/providers/); the whole host name must
 * match it, and its flags are ignored. Without it, the hosts of the first providers apply. `signal`
 * is the caller's deadline: the earlier of it and the 10 seconds ends the request.
 */
export async function providerJson(
  url: string,
  init: {
    method?: "GET" | "POST" | "PATCH";
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  } = {},
  hosts?: RegExp,
): Promise<unknown> {
  const target = new URL(url);
  const allowed = hosts
    ? new RegExp(`^(?:${hosts.source})$`)
    : OAUTH_PROVIDER_HOST;
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    !allowed.test(target.hostname)
  )
    throw new Error("Provider host not allowed");
  const timeout = AbortSignal.timeout(10_000);
  let response: Response;
  try {
    response = await withoutOutboundTelemetry(() =>
      fetch(target, {
        ...init,
        redirect: "error",
        signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      }),
    );
  } catch {
    throw new ProviderCallError(null);
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new ProviderCallError(response.status);
  }
  return answerJson(response);
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
