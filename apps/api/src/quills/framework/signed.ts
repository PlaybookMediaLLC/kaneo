import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { resendApiKey } from "@kaneo/email/quills/provider";
import { isTypeId, toUuid } from "@kaneo/ids";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Database, SignedScope } from "../../database/quills/client";
import { integrations } from "../../database/quills/schema/integrations";
import { kvStore } from "../../database/quills/schema/kv";
import {
  openCredentials,
  ProviderCallError,
  providerJson,
} from "./integration-config";
import { memberHoldsQuillsAction } from "./platform-reads";

// The signed audience: machine callers that prove themselves with a signature or a shared secret,
// never with a session. A verifier has two steps:
// 1. `locate`, before any database access: reads the raw body and headers, checks an instance
//    credential and the timestamp window where the provider signs one, and names where the
//    credential lives (SignedScope) and the delivery ID.
// 2. `verify`, inside the scoped transaction of that workspace (withQuillsSigned): reads the stored
//    secret and checks the signature in constant time. Verifiers whose locate already checked an
//    instance credential omit it.
// The workspace always comes from the credential: an integration row (quills.integration_workspace)
// or a workspace that an instance credential named. A failed check is 401 and changes nothing.

/** What a verifier reads. `raw` is the body exactly as received: signatures cover these bytes. */
export type SignedRequest = {
  raw: string;
  headers: Headers;
  params: Record<string, string>;
  query: Record<string, string>;
};
export type Located = {
  scope: SignedScope;
  /** Deduplicates deliveries. Must be covered by the signature, or be a digest of signed bytes. */
  deliveryId: string;
  /** Verified values from locate, for example the OAuth state's user. */
  claims?: Record<string, string>;
};
export type SignedVerifier<C = unknown> = {
  name: string;
  /** True when the instance credential is not configured: the route answers 404. */
  disabled?: () => boolean;
  locate: (request: SignedRequest) => Located | Promise<Located>;
  verify?: (
    db: Database,
    request: SignedRequest,
    located: Located,
  ) => Promise<C>;
};

export const unauthorized = () =>
  new HTTPException(401, { message: "Invalid signature" });
const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest();
export const digest = (value: string) => sha256(value).toString("hex");

/** Constant-time comparison. Both sides are hashed first, so the length does not leak either. */
export function safeEqual(given: string, expected: string) {
  return (
    given.length > 0 &&
    expected.length > 0 &&
    timingSafeEqual(sha256(given), sha256(expected))
  );
}

/** Receipts keep a replayed delivery a no-op for 30 days. Retention removes expired rows. */
const RECEIPT_DAYS = 30;
const receiptKey = (verifier: string, deliveryId: string) =>
  `signed:${verifier}:${digest(deliveryId)}`;

/** True when this delivery was already processed in the scoped workspace. */
export async function deliverySeen(
  db: Database,
  verifier: string,
  deliveryId: string,
) {
  const [row] = await db
    .select({ key: kvStore.key })
    .from(kvStore)
    .where(
      and(
        eq(kvStore.workspaceKey, "_"),
        eq(kvStore.key, receiptKey(verifier, deliveryId)),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Records the delivery in the caller's transaction. False when it already exists: the request is a
 * replay. A concurrent duplicate waits on the key until the first commits, then sees the conflict.
 */
export async function recordDelivery(
  db: Database,
  verifier: string,
  deliveryId: string,
) {
  const rows = await db
    .insert(kvStore)
    .values({
      workspaceKey: "_",
      key: receiptKey(verifier, deliveryId),
      value: {},
      expiresAt: new Date(Date.now() + RECEIPT_DAYS * 86_400_000),
    })
    .onConflictDoNothing()
    .returning({ key: kvStore.key });
  return rows.length > 0;
}

/** The oldest signed event time that a handler may still apply: older ones may be replays past the receipt window. */
export const replayHorizon = () =>
  new Date(Date.now() - RECEIPT_DAYS * 86_400_000);

export type IntegrationCredential = {
  integrationId: (typeof integrations.$inferSelect)["id"];
  type: string;
  config: Record<string, unknown>;
};

/**
 * Status-sync webhooks of a connected integration (GitHub, GitLab). The path names the integration;
 * its sealed `webhookSecret` checks the request: GitHub's HMAC-SHA256 of the body
 * (`X-Hub-Signature-256`), GitLab's shared token (`X-Gitlab-Token`). Neither provider signs a
 * timestamp or its delivery header, so the delivery identity is the digest of the signed body: a
 * redelivery sends the same bytes. Handlers ignore events older than `replayHorizon()`.
 */
export const integrationWebhook: SignedVerifier<IntegrationCredential> = {
  name: "integration-webhook",
  locate: ({ raw, params }) => {
    const id = params.integrationId ?? "";
    if (!isTypeId(id, "integration")) throw unauthorized();
    return {
      scope: { integration: toUuid(id) },
      deliveryId: `${params.type}:${digest(raw)}`,
    };
  },
  verify: async (db, { raw, headers, params }) => {
    const id = params.integrationId ?? "";
    if (!isTypeId(id, "integration")) throw unauthorized();
    const [row] = await db
      .select({
        id: integrations.id,
        type: integrations.integrationType,
        config: integrations.config,
        secrets: integrations.secrets,
      })
      .from(integrations)
      .where(
        and(
          eq(integrations.id, id),
          eq(integrations.integrationType, params.type ?? ""),
          eq(integrations.status, "active"),
        ),
      );
    // Status sync must be on: a disabled sync answers 401 even if a stale secret survived.
    const enabled = Boolean(
      (row?.config as { statusSync?: unknown } | undefined)?.statusSync,
    );
    const secret =
      row && enabled && openCredentials(row.secrets)?.webhookSecret;
    if (typeof secret !== "string" || !secret) throw unauthorized();
    const valid =
      row.type === "github"
        ? safeEqual(
            headers.get("x-hub-signature-256") ?? "",
            `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`,
          )
        : row.type === "gitlab"
          ? safeEqual(headers.get("x-gitlab-token") ?? "", secret)
          : false;
    if (!valid) throw unauthorized();
    return {
      integrationId: row.id,
      type: row.type,
      config: row.config as Record<string, unknown>,
    };
  },
};

const SVIX_TOLERANCE_SECONDS = 5 * 60;
const env = (name: string) => process.env[name]?.trim() || "";

/** Svix signature (Resend): base64(HMAC-SHA256(key, `${id}.${timestamp}.${body}`)), any `v1` entry. */
export function verifySvixSignature(
  request: Pick<SignedRequest, "raw" | "headers">,
  secret: string,
  now = Date.now(),
) {
  const header = (name: string) =>
    request.headers.get(`webhook-${name}`) ??
    request.headers.get(`svix-${name}`);
  const id = header("id"),
    timestamp = header("timestamp"),
    signature = header("signature");
  if (!id || !timestamp || !signature || !secret) return null;
  const seconds = Number(timestamp);
  if (
    !Number.isInteger(seconds) ||
    Math.abs(Math.floor(now / 1000) - seconds) > SVIX_TOLERANCE_SECONDS
  )
    return null;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (!key.byteLength) return null;
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${request.raw}`)
    .digest("base64");
  const valid = signature
    .split(" ")
    .some(
      (token) => token.startsWith("v1,") && safeEqual(token.slice(3), expected),
    );
  return valid ? id : null;
}

/** The workspace label of an address on the inbound domain: `<label>@domain` or `<label>+<tag>@domain`. */
export function inboundLabel(address: string, domain: string) {
  const match = /<([^<>]+)>\s*$/.exec(address);
  const bare = (match?.[1] ?? address).trim().toLowerCase();
  const at = bare.lastIndexOf("@");
  if (at < 1 || bare.slice(at + 1) !== domain.toLowerCase()) return null;
  const label = bare.slice(0, at).split("+")[0]!;
  return /^[a-z0-9][a-z0-9_-]{0,199}$/.test(label) ? label : null;
}

/**
 * Inbound mail from Resend (decision in inbound/ROUTES.md). `EMAIL_INBOUND_SIGNING_SECRET` checks the
 * Svix signature with a five-minute timestamp window; the signed `webhook-id` is the delivery ID.
 * The workspace is the owner of the receiving address on `EMAIL_INBOUND_DOMAIN`: the first `to`
 * address there names it by ID or slug. The provider signed that address with the message.
 * The route answers 404 while either variable is unset.
 */
export const resendInbound: SignedVerifier = {
  name: "resend-inbound",
  disabled: () =>
    !env("EMAIL_INBOUND_SIGNING_SECRET") || !env("EMAIL_INBOUND_DOMAIN"),
  locate: ({ raw, headers }) => {
    const id = verifySvixSignature(
      { raw, headers },
      env("EMAIL_INBOUND_SIGNING_SECRET"),
    );
    if (!id) throw unauthorized();
    let to: unknown;
    try {
      to = (JSON.parse(raw) as { data?: { to?: unknown } })?.data?.to;
    } catch {
      throw new HTTPException(400, { message: "Invalid JSON" });
    }
    const recipients = (Array.isArray(to) ? to : [to]).filter(
      (value): value is string => typeof value === "string",
    );
    const label = recipients
      .slice(0, 50)
      .map((address) => inboundLabel(address, env("EMAIL_INBOUND_DOMAIN")))
      .find(Boolean);
    if (!label)
      throw new HTTPException(404, {
        message: "No workspace receives mail at this address",
      });
    return { scope: { workspace: label }, deliveryId: id };
  },
};

/**
 * The plain-text body of a received mail. Resend's `email.received` event carries metadata only, so
 * the body comes from its Received Emails API with the instance Resend key. Null without a key or
 * when Resend no longer has the mail; another failure throws, so the provider redelivers.
 */
export async function receivedEmailText(emailId: string) {
  const key = resendApiKey();
  if (!key || !/^[A-Za-z0-9_-]{1,200}$/.test(emailId)) return null;
  try {
    const mail = (await providerJson(
      `https://api.resend.com/emails/receiving/${emailId}`,
      { headers: { authorization: `Bearer ${key}` } },
    )) as { text?: unknown } | null;
    return typeof mail?.text === "string" ? mail.text : null;
  } catch (error) {
    if (error instanceof ProviderCallError && error.status === 404) return null;
    throw error;
  }
}

/** OAuth state lifetime: the provider redirect must come back within ten minutes. */
const STATE_TTL_MS = 10 * 60 * 1000;
function stateKey() {
  const secret = env("NOTIFICATION_SECRET_ENCRYPTION_KEY");
  if (!secret)
    throw new HTTPException(409, {
      message:
        "Set NOTIFICATION_SECRET_ENCRYPTION_KEY to connect an integration.",
    });
  return createHmac("sha256", secret).update("quills-oauth-state").digest();
}
const sign = (payload: string) =>
  createHmac("sha256", stateKey()).update(payload).digest("base64url");

/**
 * A signed, expiring OAuth state that binds the redirect to the teammate who started it, the
 * workspace and the provider. The callback accepts each state once (its nonce is the delivery ID).
 */
export function mintOAuthState(
  claims: { workspaceId: string; userId: string; type: string },
  ttlMs = STATE_TTL_MS,
) {
  const payload = Buffer.from(
    JSON.stringify({
      w: claims.workspaceId,
      u: claims.userId,
      t: claims.type,
      n: randomBytes(16).toString("base64url"),
      e: Date.now() + ttlMs,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readState(state: string) {
  const [payload, signature, extra] = state.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  if (!safeEqual(signature, sign(payload))) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      w?: unknown;
      u?: unknown;
      t?: unknown;
      n?: unknown;
      e?: unknown;
    };
    if (
      typeof value.w !== "string" ||
      typeof value.u !== "string" ||
      typeof value.t !== "string" ||
      typeof value.n !== "string" ||
      typeof value.e !== "number" ||
      Date.now() > value.e
    )
      return null;
    return { w: value.w, u: value.u, t: value.t, n: value.n };
  } catch {
    return null;
  }
}

/**
 * The OAuth redirect back from a provider (`?code&state`). The state must carry a valid signature,
 * be unexpired, name this provider, and belong to the Kaneo account of the current session, which
 * must still hold `quills:manage_settings` in the state's workspace. The workspace is the state's.
 */
export const oauthState: SignedVerifier = {
  name: "oauth-state",
  locate: async ({ query, params, headers }) => {
    const state = readState(query.state ?? "");
    if (!state || state.t !== params.type) throw unauthorized();
    // Loaded on demand so that other routes and their tests never load Better Auth.
    const { getUserSession } = await import("../../utils/get-user-session");
    // getUserSession drops x-api-key: an API key never completes an OAuth redirect.
    const session = await getUserSession(headers).catch((error: unknown) => {
      // A rejected credential is no session; anything else is a server failure.
      if (
        error instanceof APIError &&
        typeof error.statusCode === "number" &&
        error.statusCode < 500
      )
        return null;
      throw error;
    });
    if (!session?.user?.id || session.user.id !== state.u) throw unauthorized();
    if (!(await memberHoldsQuillsAction(state.w, state.u, "manage_settings")))
      throw new HTTPException(403, { message: "Insufficient permission" });
    return {
      scope: { workspace: state.w },
      deliveryId: `oauth:${state.n}`,
      claims: { userId: state.u, type: state.t },
    };
  },
};

/**
 * The internal caller (job wake): `Authorization: Bearer $QUILLS_INTERNAL_TOKEN`, compared in
 * constant time. Undefined when the variable is unset: the route is then 404.
 */
export function internalTokenValid(headers: Headers) {
  const token = env("QUILLS_INTERNAL_TOKEN");
  if (!token) return undefined;
  const given = /^Bearer\s+(\S+)$/i.exec(headers.get("authorization") ?? "");
  return safeEqual(given?.[1] ?? "", token);
}
