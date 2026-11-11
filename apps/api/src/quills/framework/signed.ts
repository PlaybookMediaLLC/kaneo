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

/** A key for one purpose, derived from an instance secret. Null while the secret is unset. */
const derivedKey = (secret: string, purpose: string) =>
  secret ? createHmac("sha256", secret).update(purpose).digest() : null;
const eventsSecret = () =>
  env("EMAIL_EVENTS_SIGNING_SECRET") || env("EMAIL_INBOUND_SIGNING_SECRET");
const tagKey = () => derivedKey(eventsSecret(), "quills-mail-tags");
const tagSignature = (key: Buffer, workspaceId: string, logId: string) =>
  createHmac("sha256", key)
    .update(`${workspaceId}\0${logId}`)
    .digest("hex")
    .slice(0, 32);

/**
 * Provider tags for one outbound mail: its workspace and `email_log` row, and an HMAC over both.
 * Resend returns them with the mail's delivery events. The HMAC proves that this instance wrote
 * them, so another sender on the same provider account cannot name a workspace. Empty while no
 * events secret is set: the events route is then off.
 */
export function mailTags(workspaceId: string, logId: string) {
  const key = tagKey();
  if (!key) return [];
  return [
    { name: "kaneo_workspace", value: workspaceId },
    { name: "kaneo_log", value: logId },
    { name: "kaneo_sig", value: tagSignature(key, workspaceId, logId) },
  ];
}

/** The workspace and log row of verified tags, in Resend's map or list form, or null. */
export function readMailTags(tags: unknown) {
  const entries: [unknown, unknown][] = Array.isArray(tags)
    ? tags.map((tag) => [
        (tag as { name?: unknown })?.name,
        (tag as { value?: unknown })?.value,
      ])
    : tags && typeof tags === "object"
      ? Object.entries(tags)
      : [];
  const value = (name: string) => {
    const found = entries.find(([key]) => key === name)?.[1];
    return typeof found === "string" ? found : "";
  };
  const workspaceId = value("kaneo_workspace");
  const logId = value("kaneo_log");
  const key = tagKey();
  if (!key || !workspaceId || !isTypeId(logId, "emaillog")) return null;
  return safeEqual(value("kaneo_sig"), tagSignature(key, workspaceId, logId))
    ? { workspaceId, logId }
    : null;
}

/**
 * Delivery events from Resend (bounced, complained). `EMAIL_EVENTS_SIGNING_SECRET`, else the inbound
 * secret, checks the Svix signature; the signed `webhook-id` is the delivery ID. The workspace comes
 * from the mail's own tags, which this instance wrote and signed when it sent (`mailTags`).
 */
export const resendEvents: SignedVerifier = {
  name: "resend-events",
  disabled: () => !eventsSecret(),
  locate: ({ raw, headers }) => {
    const id = verifySvixSignature({ raw, headers }, eventsSecret());
    if (!id) throw unauthorized();
    let tags: unknown;
    try {
      tags = (JSON.parse(raw) as { data?: { tags?: unknown } })?.data?.tags;
    } catch {
      throw new HTTPException(400, { message: "Invalid JSON" });
    }
    const sent = readMailTags(tags);
    if (!sent)
      throw new HTTPException(404, {
        message: "No workspace sent this mail",
      });
    return {
      scope: { workspace: sent.workspaceId },
      deliveryId: id,
      claims: { logId: sent.logId },
    };
  },
};

const replyKey = () =>
  derivedKey(env("EMAIL_INBOUND_SIGNING_SECRET"), "quills-reply-address");
/** 12 base-36 characters (about 62 bits) of the HMAC: a local part stays case-insensitive. */
const replyTag = (key: Buffer, workspaceId: string, conversationId: string) =>
  BigInt(
    `0x${createHmac("sha256", key).update(`${workspaceId}\0${conversationId}`).digest("hex")}`,
  )
    .toString(36)
    .padStart(12, "0")
    .slice(0, 12);

/**
 * The reply address of a conversation: `<workspace slug>+c<conversation ID suffix><tag>@<inbound
 * domain>`. The slug routes the mail (`resendInbound`); workspace IDs are mixed-case and 32
 * characters, too long for a local part and lost to lower-casing. The tag is an HMAC over the
 * workspace ID and the conversation, so a reply address cannot be forged for another conversation
 * or workspace. Null while inbound mail is not configured, for a slug that is not lower-case, and
 * when the local part would pass the 64 characters of RFC 5321 (a slug of more than 24 characters).
 */
export function replyAddress(
  workspace: { id: string; slug: string },
  conversationId: string,
) {
  const key = replyKey();
  const domain = env("EMAIL_INBOUND_DOMAIN").toLowerCase();
  const suffix = conversationId.slice(conversationId.lastIndexOf("_") + 1);
  if (
    !key ||
    !domain ||
    !isTypeId(conversationId, "conversation") ||
    !/^[a-z0-9][a-z0-9_-]*$/.test(workspace.slug)
  )
    return null;
  const local = `${workspace.slug}+c${suffix}${replyTag(key, workspace.id, conversationId)}`;
  return local.length <= 64 ? `${local}@${domain}` : null;
}

/**
 * The conversation that a verified reply address among `addresses` names in this workspace (its ID,
 * as resolved from the label), or null.
 */
export function replyAddressConversation(
  addresses: readonly string[],
  workspaceId: string,
) {
  const key = replyKey();
  const domain = env("EMAIL_INBOUND_DOMAIN").toLowerCase();
  if (!key || !domain) return null;
  for (const address of addresses.slice(0, 50)) {
    const bare = (/<([^<>]+)>\s*$/.exec(address)?.[1] ?? address)
      .trim()
      .toLowerCase();
    const match =
      /^([a-z0-9][a-z0-9_-]*)\+c([0-9a-z]{26})([0-9a-z]{12})@(.+)$/.exec(bare);
    if (!match || match[4] !== domain) continue;
    const conversationId = `conversation_${match[2]}`;
    if (
      isTypeId(conversationId, "conversation") &&
      safeEqual(match[3]!, replyTag(key, workspaceId, conversationId))
    )
      return conversationId;
  }
  return null;
}

/**
 * A six-digit address verification code (widget/contact-email.ts). It is derived from the workspace's
 * widget secret and the pending request, so no code is stored and the mail worker can send the
 * same code again after a failed attempt. A new request (new nonce) or a rotated secret changes it.
 */
export function contactEmailCode(
  widgetSecret: string,
  request: {
    principalId: string;
    purpose: string;
    email: string;
    nonce: string;
  },
) {
  const digest = createHmac("sha256", widgetSecret)
    .update(
      `quills-contact-email\0${request.principalId}\0${request.purpose}\0${request.email}\0${request.nonce}`,
    )
    .digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

/** The host of the Message-IDs this instance mints: the inbound domain, else the sender's domain. */
function messageIdHost() {
  const from = env("EMAIL_FROM");
  const sender = /([^<>\s@]+@[^<>\s@]+)>?\s*$/.exec(from)?.[1] ?? "";
  return (
    env("EMAIL_INBOUND_DOMAIN") || sender.slice(sender.indexOf("@") + 1)
  ).toLowerCase();
}

/** The Message-ID of an outbound mail about a message: deterministic, so every retry names it the same. */
export function outboundMessageId(messageId: string) {
  const host = messageIdHost();
  return host ? `<${messageId}@${host}>` : undefined;
}

/** The message IDs that this instance's own Message-IDs among `ids` name. A malformed ID names none. */
export function ownMessageIds(ids: readonly string[]) {
  const host = messageIdHost();
  return ids.flatMap((id) => {
    const match = /^<(conversation_msg_[0-9a-z]{26})@([^<>\s]+)>$/.exec(
      id.trim().toLowerCase(),
    );
    return match &&
      host &&
      match[2] === host &&
      isTypeId(match[1]!, "conversation_msg")
      ? [match[1]!]
      : [];
  });
}

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
