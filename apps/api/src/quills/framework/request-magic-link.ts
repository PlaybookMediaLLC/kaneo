import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { resolveAuthSecret } from "../../utils/auth-secret";

export const REQUEST_MAGIC_LINK_DEFAULT_DAYS = 30;

export interface RequestLinkClaims {
  workspaceId: string;
  resourceType: "conversation" | "ticket";
  resourceId: string;
  principalId: string;
  /** Random nonce so each minted link has a unique DB token_hash and can be revoked independently. */
  nonce: string;
  exp: number;
}

const DOMAIN_SEP = "quills-request-link-v1\0";

function signPayload(payload: string): string {
  return createHmac("sha256", resolveAuthSecret())
    .update(`${DOMAIN_SEP}${payload}`)
    .digest("base64url");
}

/** True when an instance auth secret is available (env or AUTH_SECRET_FILE). */
export function canMintRequestLinkToken(): boolean {
  try {
    return Boolean(resolveAuthSecret());
  } catch {
    return false;
  }
}

/** Deterministic SHA-256 hex digest stored in `quills.request_access_links.token_hash`. */
export function hashRequestLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mints a signed, single-resource magic link token (`rl1.<payload>.<sig>`).
 * Every token is ALSO backed by a row in `quills.request_access_links` so agents
 * can revoke individual or all links for a conversation instantly (< 1s).
 */
export function mintRequestLinkToken(params: {
  workspaceId: string;
  resourceType: "conversation" | "ticket";
  resourceId: string;
  principalId: string;
  ttlDays?: number;
  now?: number;
}): { token: string; tokenHash: string; expiresAt: Date } {
  const now = params.now ?? Date.now();
  const ttlMs =
    Math.max(
      1,
      Math.min(90, params.ttlDays ?? REQUEST_MAGIC_LINK_DEFAULT_DAYS),
    ) * 86_400_000;
  const exp = now + ttlMs;
  const nonce = randomBytes(12).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      w: params.workspaceId,
      t: params.resourceType,
      r: params.resourceId,
      p: params.principalId,
      n: nonce,
      e: exp,
    }),
  ).toString("base64url");
  const token = `rl1.${payload}.${signPayload(payload)}`;
  return {
    token,
    tokenHash: hashRequestLinkToken(token),
    expiresAt: new Date(exp),
  };
}

/** Verifies the HMAC signature and expiration without hitting the database. */
export function verifyRequestLinkToken(
  token: string,
  expectedWorkspaceId: string,
  now = Date.now(),
): RequestLinkClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "rl1") return null;
  const payload = parts[1]!;
  const sig = parts[2]!;
  const expected = signPayload(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as {
      w?: unknown;
      t?: unknown;
      r?: unknown;
      p?: unknown;
      n?: unknown;
      e?: unknown;
    };
    if (
      typeof data.w !== "string" ||
      data.w !== expectedWorkspaceId ||
      (data.t !== "conversation" && data.t !== "ticket") ||
      typeof data.r !== "string" ||
      typeof data.p !== "string" ||
      typeof data.n !== "string" ||
      typeof data.e !== "number" ||
      now > data.e
    ) {
      return null;
    }
    return {
      workspaceId: data.w,
      resourceType: data.t,
      resourceId: data.r,
      principalId: data.p,
      nonce: data.n,
      exp: data.e,
    };
  } catch {
    return null;
  }
}

export const PUBLIC_MEDIA_DEFAULT_TTL_DAYS = 90;

/** Sign a long-lived public media token (`qm1.<payload>.<sig>`) using the instance auth secret (#326). */
export function mintPublicMediaToken(params: {
  workspaceId: string;
  fileId: string;
  ttlDays?: number;
  now?: number;
}): string {
  const now = params.now ?? Date.now();
  const exp =
    now +
    Math.max(
      1,
      Math.min(365, params.ttlDays ?? PUBLIC_MEDIA_DEFAULT_TTL_DAYS),
    ) *
      86_400_000;
  const payload = Buffer.from(
    JSON.stringify({ w: params.workspaceId, f: params.fileId, e: exp }),
  ).toString("base64url");
  const sig = createHmac("sha256", resolveAuthSecret())
    .update(`quills-media-v1\0${payload}`)
    .digest("base64url");
  return `qm1.${payload}.${sig}`;
}

/** Verify a public media token against the instance auth secret (#326). */
export function verifyInstancePublicMediaToken(
  token: string,
  expectedWorkspaceId: string,
  now = Date.now(),
): { workspaceId: string; fileId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "qm1") return null;
  const payload = parts[1]!;
  const sig = parts[2]!;
  const expected = createHmac("sha256", resolveAuthSecret())
    .update(`quills-media-v1\0${payload}`)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { w?: unknown; f?: unknown; e?: unknown };
    if (
      typeof parsed.w !== "string" ||
      parsed.w !== expectedWorkspaceId ||
      typeof parsed.f !== "string" ||
      typeof parsed.e !== "number" ||
      now > parsed.e
    ) {
      return null;
    }
    return { workspaceId: parsed.w, fileId: parsed.f };
  } catch {
    return null;
  }
}
