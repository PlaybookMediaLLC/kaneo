import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { isIP } from "node:net";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../database/quills/client";
import { principal, user as customer } from "../../database/quills/schema/auth";
import { kvStore, rateBucket } from "../../database/quills/schema/kv";
import { spamBlocks } from "../../database/quills/schema/spam-blocks";
import { verifyTurnstile } from "../../utils/verify-turnstile";

// Anti-spam framework helpers (#320): origin allow-list matching, CIDR/email-domain/visitor
// blocklist checks, 3-tier workspace quotas, and stateless HMAC-signed SHA-256 Proof-of-Work /
// optional Turnstile challenges (zero third-party dependencies for self-hosted deployments).

export const CHALLENGE_MODES = ["off", "adaptive", "always"] as const;
export type ChallengeMode = (typeof CHALLENGE_MODES)[number];
export const CHALLENGE_PROVIDERS = ["pow", "turnstile"] as const;
export type ChallengeProvider = (typeof CHALLENGE_PROVIDERS)[number];

export const challengeInputSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("pow"),
    token: z.string().min(1).max(256),
    nonce: z.string().min(1).max(64),
  }),
  z.object({
    provider: z.literal("turnstile"),
    token: z.string().min(1).max(4096),
  }),
]);
export type ChallengeInput = z.infer<typeof challengeInputSchema>;

export type WidgetRateLimits = {
  conversationsPerIp10m: number;
  sessionsPerIpHour: number;
  workspaceConversationsPer10m: number;
};

export type WidgetAntiSpamConfig = {
  allowedOrigins: string[];
  rateLimits: WidgetRateLimits;
  challengeMode: ChallengeMode;
  challengeProvider: ChallengeProvider;
};

export const DEFAULT_RATE_LIMITS: WidgetRateLimits = {
  conversationsPerIp10m: 20,
  sessionsPerIpHour: 10,
  workspaceConversationsPer10m: 200,
};

/** Normalizes an allowed origin pattern (e.g. `https://app.acme.com` or `https://*.acme.com`). */
export function normalizeOriginPattern(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/\/+$/, "");
  if (!trimmed || trimmed.length > 253) return null;
  const wildcard =
    /^(https?):\/\/\*\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::(\d{1,5}))?$/.exec(
      trimmed,
    );
  if (wildcard) {
    const [, proto, host, port] = wildcard;
    let normalizedPort = "";
    if (port) {
      const portNum = Number(port);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)
        return null;
      const isDefault =
        (proto === "https" && portNum === 443) ||
        (proto === "http" && portNum === 80);
      if (!isDefault) normalizedPort = `:${portNum}`;
    }
    return `${proto}://*.${host}${normalizedPort}`;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Whether a request Origin or Referer matches the workspace's widget allowedOrigins list. */
export function isOriginAllowed(
  originHeader: string | null | undefined,
  refererHeader: string | null | undefined,
  allowedOrigins: readonly string[],
  selfOrigin?: string | null,
): boolean {
  if (!allowedOrigins.length) return true;
  if (originHeader && originHeader.trim().toLowerCase() === "null") {
    return false;
  }
  let candidate: string | null = null;
  if (originHeader) {
    try {
      candidate = new URL(originHeader).origin.toLowerCase();
    } catch {
      return false;
    }
  } else if (refererHeader) {
    try {
      candidate = new URL(refererHeader).origin.toLowerCase();
    } catch {
      return false;
    }
  }
  // Same-origin or server-to-server requests without Origin/Referer remain allowed when no origin header is sent.
  if (!candidate) return true;
  // Hosted widget iframe calls come from Kaneo's own origin; framing is restricted by frame-ancestors CSP.
  if (selfOrigin && candidate === selfOrigin.toLowerCase()) return true;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  const candProto = parsed.protocol.slice(0, -1);
  const candHost = parsed.hostname.toLowerCase();
  const candPort = parsed.port;
  for (const rawPattern of allowedOrigins) {
    const pattern = normalizeOriginPattern(rawPattern);
    if (!pattern) continue;
    if (pattern === candidate) return true;
    const wildcard = /^(https?):\/\/\*\.([a-z0-9.-]+)(?::(\d+))?$/.exec(
      pattern,
    );
    if (wildcard) {
      const [, proto, baseHost, port = ""] = wildcard;
      if (
        proto === candProto &&
        port === candPort &&
        candHost.endsWith(`.${baseHost}`) &&
        candHost.length > baseHost!.length + 1
      ) {
        return true;
      }
    }
  }
  return false;
}

function maskIpv4(ip: string, prefix: number): string {
  const octets = ip.split(".").map(Number);
  const num =
    (((octets[0]! << 24) |
      (octets[1]! << 16) |
      (octets[2]! << 8) |
      octets[3]!) >>>
      0) &
    (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);
  return `${(num >>> 24) & 255}.${(num >>> 16) & 255}.${(num >>> 8) & 255}.${num & 255}`;
}

function maskIpv6(ip: string, prefix: number): string {
  const [head, tail] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const missing = 8 - (headParts.length + tailParts.length);
  const full =
    tail !== undefined
      ? [...headParts, ...Array(Math.max(0, missing)).fill("0"), ...tailParts]
      : headParts;
  const words = full.map((part) => Number.parseInt(part || "0", 16));
  for (let i = 0; i < 8; i++) {
    const bitsInWord = Math.min(16, Math.max(0, prefix - i * 16));
    const mask = bitsInWord === 0 ? 0 : (0xffff << (16 - bitsInWord)) & 0xffff;
    words[i] = words[i]! & mask;
  }
  const hex = words.map((w) => w.toString(16));
  let bestStart = -1;
  let bestLen = 1;
  for (let i = 0; i < 8;) {
    if (words[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && words[j] === 0) j++;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  if (bestStart === -1) return hex.join(":");
  const left = hex.slice(0, bestStart).join(":");
  const right = hex.slice(bestStart + bestLen).join(":");
  return `${left}::${right}`;
}

/** Validates and canonicalizes an IPv4/IPv6 address or CIDR range (masks host bits so ::cidr never fails). */
export function normalizeCidr(raw: string): string | null {
  const trimmed = raw.trim();
  const parts = trimmed.split("/");
  if (parts.length > 2) return null;
  if (parts.length === 2 && !/^\d+$/.test(parts[1]!)) return null;
  const ip = parts[0]!;
  const family = isIP(ip);
  if (family === 0) return null;
  const max = family === 4 ? 32 : 128;
  const prefix = parts.length === 1 ? max : Number(parts[1]);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  if (family === 4) return `${maskIpv4(ip, prefix)}/${prefix}`;
  if (ip.includes(".")) return `${ip}/${prefix}`;
  return `${maskIpv6(ip, prefix)}/${prefix}`;
}

/** Validates an email domain for spam blocking (e.g. `spammer.example`). */
export function normalizeEmailDomain(raw: string): string | null {
  const clean = raw.trim().toLowerCase().replace(/^@+/, "");
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
      clean,
    )
  ) {
    return null;
  }
  return clean;
}

/** Extracts normalized domain from an email address, or null. */
export function emailDomainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return normalizeEmailDomain(email.slice(at + 1));
}

/** Checks quills.spam_blocks for a live CIDR, email-domain, or visitor-principal block. */
export async function isSpamBlocked(
  db: Database,
  input: {
    ip?: string | null;
    email?: string | null;
    principalId?: string | null;
  },
): Promise<{ blocked: boolean; kind?: string; value?: string }> {
  const live = or(
    isNull(spamBlocks.expiresAt),
    gt(spamBlocks.expiresAt, sql`now()`),
  );
  const checks = [];
  const validIp = input.ip && isIP(input.ip) !== 0 ? input.ip : null;
  if (validIp) {
    checks.push(
      sql`CASE WHEN ${spamBlocks.kind} = 'ip_cidr' THEN ${validIp}::inet <<= network(${spamBlocks.value}::inet) ELSE false END`,
    );
  }
  let resolvedEmail = input.email ?? null;
  if (!resolvedEmail && input.principalId) {
    const [row] = await db
      .select({
        contactEmail: principal.contactEmail,
        userEmail: customer.email,
      })
      .from(principal)
      .leftJoin(customer, eq(customer.id, principal.userId))
      .where(eq(principal.id, input.principalId as never))
      .limit(1);
    resolvedEmail = row?.userEmail ?? row?.contactEmail ?? null;
  }
  const domain = emailDomainOf(resolvedEmail);
  if (domain) {
    checks.push(
      and(eq(spamBlocks.kind, "email_domain"), eq(spamBlocks.value, domain)),
    );
  }
  if (input.principalId) {
    checks.push(
      and(
        eq(spamBlocks.kind, "visitor_principal"),
        eq(spamBlocks.value, input.principalId),
      ),
    );
  }
  if (!checks.length) return { blocked: false };
  const [match] = await db
    .select({ kind: spamBlocks.kind, value: spamBlocks.value })
    .from(spamBlocks)
    .where(and(live, or(...checks)))
    .limit(1);
  return match
    ? { blocked: true, kind: match.kind, value: match.value }
    : { blocked: false };
}

// --- Stateless HMAC-signed SHA-256 Proof-of-Work challenge ---

const POW_TTL_SECONDS = 300;
const DEFAULT_POW_DIFFICULTY = 14; // ~16k SHA-256 hashes (~15–40ms in browser, costly for floods)
const MIN_POW_DIFFICULTY = 8;

const powSecret = () => {
  const secret = process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set to sign anti-spam PoW challenges");
  }
  return "quills-pow-challenge-dev";
};

function signPow(payload: string): string {
  return createHmac("sha256", powSecret()).update(payload).digest("base64url");
}

function hasLeadingZeroBits(buf: Buffer, bits: number): boolean {
  let remaining = bits;
  for (const byte of buf) {
    if (remaining <= 0) return true;
    if (remaining >= 8) {
      if (byte !== 0) return false;
      remaining -= 8;
    } else {
      const mask = 0xff << (8 - remaining);
      return (byte & mask) === 0;
    }
  }
  return true;
}

export function mintPowChallenge(
  workspaceId: string,
  ip: string | null,
  difficulty = DEFAULT_POW_DIFFICULTY,
) {
  const salt = randomBytes(12).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + POW_TTL_SECONDS;
  const ipTag = createHmac("sha256", powSecret())
    .update(ip ?? "unknown")
    .digest("base64url")
    .slice(0, 16);
  const payload = `${workspaceId}.${ipTag}.${difficulty}.${exp}.${salt}`;
  const sig = signPow(payload);
  return {
    token: `${payload}.${sig}`,
    difficulty,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/** Solves a PoW challenge (used by clients and tests). */
export function solvePowChallenge(token: string): string {
  const parts = token.split(".");
  const difficulty = Number(parts[2] ?? DEFAULT_POW_DIFFICULTY);
  for (let nonce = 0; nonce < 10_000_000; nonce++) {
    const digest = createHash("sha256").update(`${token}:${nonce}`).digest();
    if (hasLeadingZeroBits(digest, difficulty)) return String(nonce);
  }
  throw new Error("Could not solve PoW challenge");
}

/** Verifies a PoW solution and marks the challenge single-use in kv_store. */
export async function verifyAndConsumePow(
  db: Database,
  workspaceId: string,
  ip: string | null,
  token: string,
  nonce: string,
): Promise<boolean> {
  if (!token || !nonce || token.length > 256 || nonce.length > 64) return false;
  const parts = token.split(".");
  if (parts.length !== 6) return false;
  const [ws, ipTag, diffStr, expStr, salt, sig] = parts;
  if (ws !== workspaceId || !ipTag || !salt || !sig) return false;
  const difficulty = Number(diffStr);
  const exp = Number(expStr);
  if (
    !Number.isInteger(difficulty) ||
    difficulty < MIN_POW_DIFFICULTY ||
    difficulty > 24 ||
    !Number.isInteger(exp) ||
    exp < Math.floor(Date.now() / 1000)
  ) {
    return false;
  }
  const payload = `${ws}.${ipTag}.${diffStr}.${expStr}.${salt}`;
  const expectedSig = Buffer.from(signPow(payload));
  const givenSig = Buffer.from(sig);
  if (
    expectedSig.length !== givenSig.length ||
    !timingSafeEqual(expectedSig, givenSig)
  ) {
    return false;
  }
  const expectedIpTag = Buffer.from(
    createHmac("sha256", powSecret())
      .update(ip ?? "unknown")
      .digest("base64url")
      .slice(0, 16),
  );
  const givenIpTag = Buffer.from(ipTag);
  if (
    expectedIpTag.length !== givenIpTag.length ||
    !timingSafeEqual(expectedIpTag, givenIpTag)
  ) {
    return false;
  }
  const digest = createHash("sha256").update(`${token}:${nonce}`).digest();
  if (!hasLeadingZeroBits(digest, difficulty)) return false;

  // Mark challenge single-use in kv_store so the same solution cannot be replayed.
  const key = `pow_used:${createHash("sha256").update(token).digest("hex").slice(0, 40)}`;
  const inserted = await db
    .insert(kvStore)
    .values({
      workspaceKey: "_",
      key,
      value: { used: true },
      expiresAt: new Date(exp * 1000 + 60_000),
    })
    .onConflictDoNothing()
    .returning({ key: kvStore.key });
  return inserted.length === 1;
}

/** Extracts widget anti-spam settings with safe defaults. */
export function readWidgetAntiSpam(
  stored: Record<string, unknown>,
): WidgetAntiSpamConfig {
  const rawOrigins = Array.isArray(stored.allowedOrigins)
    ? stored.allowedOrigins
    : [];
  const allowedOrigins = rawOrigins
    .filter((v): v is string => typeof v === "string")
    .map(normalizeOriginPattern)
    .filter((v): v is string => v !== null)
    .slice(0, 50);

  const rawAntiSpam =
    stored.antiSpam && typeof stored.antiSpam === "object"
      ? (stored.antiSpam as Record<string, unknown>)
      : {};
  const rawLimits =
    rawAntiSpam.rateLimits && typeof rawAntiSpam.rateLimits === "object"
      ? (rawAntiSpam.rateLimits as Record<string, unknown>)
      : {};

  const clamp = (val: unknown, fallback: number, min: number, max: number) =>
    typeof val === "number" && Number.isInteger(val) && val >= min && val <= max
      ? val
      : fallback;

  const challengeMode = (CHALLENGE_MODES as readonly string[]).includes(
    String(rawAntiSpam.challengeMode),
  )
    ? (rawAntiSpam.challengeMode as ChallengeMode)
    : "adaptive";
  const challengeProvider = (CHALLENGE_PROVIDERS as readonly string[]).includes(
    String(rawAntiSpam.challengeProvider),
  )
    ? (rawAntiSpam.challengeProvider as ChallengeProvider)
    : "pow";

  return {
    allowedOrigins,
    rateLimits: {
      conversationsPerIp10m: clamp(
        rawLimits.conversationsPerIp10m,
        DEFAULT_RATE_LIMITS.conversationsPerIp10m,
        1,
        500,
      ),
      sessionsPerIpHour: clamp(
        rawLimits.sessionsPerIpHour,
        DEFAULT_RATE_LIMITS.sessionsPerIpHour,
        1,
        500,
      ),
      workspaceConversationsPer10m: clamp(
        rawLimits.workspaceConversationsPer10m,
        DEFAULT_RATE_LIMITS.workspaceConversationsPer10m,
        5,
        10_000,
      ),
    },
    challengeMode,
    challengeProvider,
  };
}

/** Parses widgetConfig JSON safely and returns WidgetAntiSpamConfig. */
export function parseWidgetAntiSpam(
  widgetConfigJson: string | null | undefined,
): WidgetAntiSpamConfig {
  if (!widgetConfigJson) return readWidgetAntiSpam({});
  try {
    const parsed = JSON.parse(widgetConfigJson);
    if (parsed && typeof parsed === "object") {
      return readWidgetAntiSpam(parsed as Record<string, unknown>);
    }
  } catch {
    // fall through to defaults
  }
  return readWidgetAntiSpam({});
}

async function incrementBucket(
  db: Database,
  key: string,
  windowSeconds: number,
  limit: number,
): Promise<{ count: number; exceeded: boolean; retryAfter: number }> {
  const [row] = await db
    .insert(rateBucket)
    .values({
      workspaceKey: "_",
      key,
      count: 1,
      windowExpiresAt: sql`now() + make_interval(secs => ${windowSeconds})`,
    })
    .onConflictDoUpdate({
      target: [rateBucket.workspaceId, rateBucket.workspaceKey, rateBucket.key],
      set: {
        count: sql`CASE WHEN ${rateBucket.windowExpiresAt} <= now() THEN 1 ELSE ${rateBucket.count} + 1 END`,
        windowExpiresAt: sql`CASE WHEN ${rateBucket.windowExpiresAt} <= now() THEN excluded.window_expires_at ELSE ${rateBucket.windowExpiresAt} END`,
      },
    })
    .returning({
      count: rateBucket.count,
      expiresAt: rateBucket.windowExpiresAt,
    });
  const count = row?.count ?? 1;
  const retryAfter = row
    ? Math.max(1, Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000))
    : windowSeconds;
  return { count, exceeded: count > limit, retryAfter };
}

function throwTooManyRequests(retryAfter: number): never {
  throw new HTTPException(429, {
    res: new Response(
      JSON.stringify({ message: "Too many requests", retryAfter }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(retryAfter),
        },
      },
    ),
  });
}

function throwChallengeError(
  code: "CHALLENGE_REQUIRED" | "CHALLENGE_INVALID",
  provider: ChallengeProvider,
): never {
  throw new HTTPException(403, {
    res: new Response(
      JSON.stringify({
        code,
        provider,
        message:
          code === "CHALLENGE_REQUIRED"
            ? "Anti-spam challenge required"
            : "Anti-spam challenge verification failed",
      }),
      {
        status: 403,
        headers: { "content-type": "application/json" },
      },
    ),
  });
}

/**
 * Enforces configurable 3-tier rate limits (per-IP, per-session, per-workspace) and
 * adaptive/always PoW or Turnstile challenge verification for widget entry points.
 * Rate buckets commit in a separate short transaction so 403 challenge rejections do not
 * roll back flood counters.
 */
export async function enforceWidgetAntiSpam(
  db: Database,
  input: {
    workspaceId: string;
    widgetConfig: string | null | undefined;
    kind: "session" | "conversation";
    ip: string | null;
    sessionId?: string | null;
    challenge?:
      | ChallengeInput
      | { provider: string; token: string; nonce?: string }
      | null;
  },
): Promise<void> {
  const cfg = parseWidgetAntiSpam(input.widgetConfig);
  const clientKey = input.ip ?? "unknown";

  const isSession = input.kind === "session";
  const windowSeconds = isSession ? 3600 : 600;
  const ipLimit = isSession
    ? cfg.rateLimits.sessionsPerIpHour
    : cfg.rateLimits.conversationsPerIp10m;
  const workspaceLimit = isSession
    ? cfg.rateLimits.workspaceConversationsPer10m * 6
    : cfg.rateLimits.workspaceConversationsPer10m;

  const bucketResults = await withQuillsSystemWorkspace(
    input.workspaceId,
    async (bucketDb) => {
      const ipRes = await incrementBucket(
        bucketDb,
        `antispam:${input.kind}:ip:${clientKey}`,
        windowSeconds,
        ipLimit,
      );
      if (ipRes.exceeded) return { exceeded: ipRes.retryAfter };

      if (!isSession && input.sessionId) {
        const sessionLimit = Math.min(ipLimit, 10);
        const sessionRes = await incrementBucket(
          bucketDb,
          `antispam:conversation:session:${input.sessionId}`,
          windowSeconds,
          sessionLimit,
        );
        if (sessionRes.exceeded) return { exceeded: sessionRes.retryAfter };
      }

      const wsRes = await incrementBucket(
        bucketDb,
        `antispam:${input.kind}:workspace`,
        windowSeconds,
        workspaceLimit,
      );
      if (wsRes.exceeded) return { exceeded: wsRes.retryAfter };

      return { ipCount: ipRes.count, wsCount: wsRes.count };
    },
  );

  if ("exceeded" in bucketResults && bucketResults.exceeded !== undefined) {
    throwTooManyRequests(bucketResults.exceeded);
  }

  const needChallenge =
    cfg.challengeMode === "always" ||
    (cfg.challengeMode === "adaptive" &&
      (bucketResults.ipCount > Math.ceil(ipLimit * 0.75) ||
        bucketResults.wsCount > Math.ceil(workspaceLimit * 0.5)));

  if (!needChallenge) return;

  const parsed = challengeInputSchema.safeParse(input.challenge);
  if (!parsed.success) {
    throwChallengeError("CHALLENGE_REQUIRED", cfg.challengeProvider);
  }
  if (parsed.data.provider !== cfg.challengeProvider) {
    throwChallengeError("CHALLENGE_INVALID", cfg.challengeProvider);
  }

  if (parsed.data.provider === "pow") {
    const ok = await verifyAndConsumePow(
      db,
      input.workspaceId,
      input.ip,
      parsed.data.token,
      parsed.data.nonce,
    );
    if (!ok) throwChallengeError("CHALLENGE_INVALID", "pow");
    return;
  }

  if (
    !process.env.TURNSTILE_SECRET_KEY &&
    !process.env.TURNSTILE_SECRET_KEY_FILE
  ) {
    throwChallengeError("CHALLENGE_INVALID", "turnstile");
  }
  const allowedHostnames = cfg.allowedOrigins
    .map((origin) => {
      try {
        const isWildcard = /^https?:\/\/\*\./i.test(origin);
        const host = new URL(origin.replace("*.", "")).hostname;
        return isWildcard ? `*.${host}` : host;
      } catch {
        return null;
      }
    })
    .filter((h): h is string => Boolean(h));
  const turnstileResult = await verifyTurnstile(parsed.data.token, {
    expectedAction: "widget",
    ...(allowedHostnames.length > 0 && { allowedHostnames }),
  });
  if (!turnstileResult.ok)
    throwChallengeError("CHALLENGE_INVALID", "turnstile");
}

/** Whether an email address matches the workspace's spamFilterConfig.trustedSenders list. */
export function isTrustedSender(
  spamFilterConfigJson: string | null | undefined,
  email: string | null | undefined,
): boolean {
  if (!email || !spamFilterConfigJson) return false;
  let trusted: string[] = [];
  try {
    const parsed = JSON.parse(spamFilterConfigJson);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray(parsed.trustedSenders)
    ) {
      trusted = parsed.trustedSenders
        .filter((v: unknown): v is string => typeof v === "string")
        .map((v: string) => v.trim().toLowerCase());
    }
  } catch {
    return false;
  }
  if (!trusted.length) return false;
  const lower = email.trim().toLowerCase();
  const domain = emailDomainOf(lower);
  return trusted.some(
    (entry) => entry === lower || (domain !== null && entry === domain),
  );
}
