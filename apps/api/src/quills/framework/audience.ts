import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { isValidTypeId } from "@kaneo/ids";
import { APIError } from "better-auth/api";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  QuillsWorkspaceUnavailable,
  withQuillsAudience,
  type Database,
} from "../../database/quills/client";
import {
  principal,
  settings,
  user as customer,
} from "../../database/quills/schema/auth";
import { rateBucket, kvStore } from "../../database/quills/schema/kv";
import { segments, userSegments } from "../../database/quills/schema/segments";
import { readClientIp } from "../../utils/client-ip";
import type { ChangeActor } from "../events";
import { isMemberOfNamedWorkspace } from "./platform-reads";

// One resolver per audience that is not a teammate. A resolver reads the caller's credential
// from the request, then, inside the scoped transaction, returns the customer principal (or
// none) that the handler acts for. A teammate on a portal route is a customer here: this module
// never reads Kaneo roles or permissions and never creates a teammate principal. Membership is
// read once, only for the private-portal team grant.

export type QuillsAudience = "portal" | "widget" | "public";

/** The signed-in Kaneo account behind a portal request (decision D1). */
export type PortalAccount = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  /** A member of the named workspace. Only the private-portal team grant reads it. */
  member: boolean;
};

export type QuillsCaller = {
  /**
   * The caller's customer principal. Null for public, for a portal account with no profile
   * here yet, and for a widget request without a live session.
   */
  principalId: PrincipalId | null;
  customerId: CustomerId | null;
  /** Portal only: the Kaneo account from the session. */
  account: PortalAccount | null;
};

type PrincipalId = typeof principal.$inferSelect.id;
type CustomerId = typeof customer.$inferSelect.id;
type SegmentId = typeof segments.$inferSelect.id;
type Credentials = { account: PortalAccount | null; tokenHash: string | null };

const WIDGET_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Binds a widget session to the secret that verified its identify: rotation ends the session. */
const secretFingerprint = (secret: string) =>
  createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 32);
const sessionValue = z.object({
  secret: z.string(),
  principalId: z.custom<PrincipalId>(
    (v) => typeof v === "string" && isValidTypeId(v, "principal"),
  ),
  customerId: z.custom<CustomerId>(
    (v) => typeof v === "string" && isValidTypeId(v, "user"),
  ),
});

export const hashToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");
const sessionKey = (tokenHash: string) => `widget:session:${tokenHash}`;

function bearer(c: Context) {
  const match = c.req.header("authorization")?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

async function portalAccount(
  c: Context,
  workspace: string,
): Promise<PortalAccount | null> {
  // Loaded on demand so that teammate routes and their tests never load Better Auth.
  const { getUserSession } = await import("../../utils/get-user-session");
  try {
    // getUserSession drops x-api-key: an API key never acts as a portal customer.
    const session = await getUserSession(c.req.raw.headers);
    if (!session?.user) return null;
    const { id, name, email, emailVerified, image } = session.user;
    return {
      id,
      name: name || email.split("@")[0] || "Customer",
      email,
      emailVerified,
      image: image ?? null,
      member: await isMemberOfNamedWorkspace(workspace, id),
    };
  } catch (error) {
    // A rejected credential is an anonymous caller; anything else is a server failure.
    if (
      error instanceof APIError &&
      typeof error.statusCode === "number" &&
      error.statusCode < 500
    )
      return null;
    throw error;
  }
}

/** Reads the audience's credential before the transaction. Never reads identity from input. */
export async function readCredentials(
  c: Context,
  audience: QuillsAudience,
  workspace: string,
): Promise<Credentials> {
  if (audience === "portal")
    return { account: await portalAccount(c, workspace), tokenHash: null };
  const token = audience === "widget" ? bearer(c) : null;
  return { account: null, tokenHash: token ? hashToken(token) : null };
}

async function portalCaller(
  db: Database,
  account: PortalAccount,
  ensure: boolean,
) {
  const find = async () =>
    (
      await db
        .select({
          customerId: customer.id,
          principalId: principal.id,
          blockedAt: principal.blockedAt,
        })
        .from(customer)
        .leftJoin(principal, eq(principal.userId, customer.id))
        .where(eq(customer.kaneoUserId, account.id))
        .limit(1)
    )[0];
  let row = await find();
  if (ensure && !row?.principalId) {
    // The customer_membership trigger accepts this link only for the account the entry point vouched for.
    // The email stays on the Kaneo account: a profile is never matched to an account by email.
    if (!row)
      await db
        .insert(customer)
        .values({
          kaneoUserId: account.id,
          name: account.name,
          image: account.image,
        })
        .onConflictDoNothing();
    const linked = row ?? (await find());
    await db
      .insert(principal)
      .values({
        userId: linked!.customerId,
        role: "user",
        type: "user",
        displayName: account.name,
        avatarUrl: account.image,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
    row = await find();
  }
  return row;
}

async function widgetCaller(db: Database, tokenHash: string) {
  const [stored] = await db
    .select({ value: kvStore.value })
    .from(kvStore)
    .where(
      and(
        eq(kvStore.workspaceKey, "_"),
        eq(kvStore.key, sessionKey(tokenHash)),
        gt(kvStore.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  const session = sessionValue.safeParse(stored?.value);
  if (!session.success) return undefined;
  // A session ends when the widget is turned off or its secret is rotated.
  const [config] = await db
    .select({
      widgetConfig: settings.widgetConfig,
      widgetSecret: settings.widgetSecret,
    })
    .from(settings)
    .limit(1);
  if (
    !config?.widgetSecret ||
    secretFingerprint(config.widgetSecret) !== session.data.secret ||
    !widgetEnabled(config.widgetConfig)
  )
    return undefined;
  const [row] = await db
    .select({ principalId: principal.id, blockedAt: principal.blockedAt })
    .from(principal)
    .where(
      and(
        eq(principal.id, session.data.principalId),
        eq(principal.userId, session.data.customerId),
      ),
    )
    .limit(1);
  return row && { ...row, customerId: session.data.customerId };
}

/** True when the stored widget configuration turns the widget on. */
export function widgetEnabled(stored: string | null) {
  try {
    return (
      (JSON.parse(stored || "{}") as { enabled?: unknown })?.enabled === true
    );
  } catch {
    return false;
  }
}

/** Resolves the caller inside the scoped transaction. */
export async function resolveCaller(
  db: Database,
  audience: QuillsAudience,
  credentials: Credentials,
  rules: { signIn: boolean; ensureCustomer: boolean },
): Promise<QuillsCaller> {
  const caller: QuillsCaller = {
    principalId: null,
    customerId: null,
    account: credentials.account,
  };
  if (audience === "portal" && credentials.account) {
    const row = await portalCaller(
      db,
      credentials.account,
      rules.ensureCustomer,
    );
    if (row?.blockedAt)
      throw new HTTPException(403, { message: "This account is blocked" });
    caller.customerId = row?.customerId ?? null;
    caller.principalId = row?.principalId ?? null;
  }
  if (audience === "widget" && credentials.tokenHash) {
    const row = await widgetCaller(db, credentials.tokenHash);
    if (row?.blockedAt)
      throw new HTTPException(403, { message: "This account is blocked" });
    if (row) {
      caller.principalId = row.principalId;
      caller.customerId = row.customerId;
    }
  }
  const signedIn =
    audience === "portal"
      ? Boolean(caller.account)
      : Boolean(caller.principalId);
  if (rules.signIn && audience !== "public" && !signedIn)
    throw new HTTPException(401, {
      message:
        audience === "portal"
          ? "Sign-in required"
          : "Valid widget session required",
    });
  return caller;
}

export const callerActor = (caller: QuillsCaller): ChangeActor => ({
  principalId: caller.principalId,
  actorType: caller.principalId ? "customer" : "anonymous",
});

/**
 * Mints a widget session for a customer that a token signed with `secret` identified. Only the
 * SHA-256 hash of the session token is stored. HMAC provenance for the portal handoff is not
 * recorded until the handoff exists.
 */
export async function mintWidgetSession(
  db: Database,
  owner: { principalId: PrincipalId; customerId: CustomerId },
  secret: string,
  expiresAt = new Date(Date.now() + WIDGET_SESSION_TTL_MS),
) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(kvStore).values({
    workspaceKey: "_",
    key: sessionKey(hashToken(token)),
    value: { secret: secretFingerprint(secret), ...owner },
    expiresAt,
  });
  return { token };
}

/** The claims of an HS256 JWT signed with `secret`, or null. The token must carry exp. */
export function verifyIdentityToken(token: string, secret: string) {
  const [header, payload, signature, extra] = token.split(".");
  if (!header || !payload || !signature || extra !== undefined) return null;
  try {
    if (JSON.parse(Buffer.from(header, "base64url").toString()).alg !== "HS256")
      return null;
    const expected = createHmac("sha256", secret)
      .update(`${header}.${payload}`)
      .digest();
    const given = Buffer.from(signature, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      return null;
    const claims: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    );
    if (!claims || typeof claims !== "object") return null;
    const { exp, nbf } = claims as { exp?: unknown; nbf?: unknown };
    const now = Date.now() / 1000;
    // Stricter than the source: a token without exp would never expire.
    if (typeof exp !== "number" || now > exp) return null;
    if (typeof nbf === "number" && now < nbf) return null;
    return claims as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Counts one attempt for this client in its own committed transaction, so a failed request
 * still spends budget. 429 over the limit.
 */
export async function enforceRateLimit(
  c: Context,
  workspace: string,
  name: string,
  rule: { limit: number; windowSeconds: number },
) {
  // ponytail: the bucket is per workspace and client IP; a client spreading attempts over many workspaces gets a budget in each.
  const key = `${name}:${readClientIp(c.req.raw.headers) ?? "unknown"}`;
  const count = await withQuillsAudience({ workspace }, async (db) => {
    const [row] = await db
      .insert(rateBucket)
      .values({
        workspaceKey: "_",
        key,
        count: 1,
        windowExpiresAt: sql`now() + make_interval(secs => ${rule.windowSeconds})`,
      })
      .onConflictDoUpdate({
        target: [
          rateBucket.workspaceId,
          rateBucket.workspaceKey,
          rateBucket.key,
        ],
        set: {
          count: sql`CASE WHEN ${rateBucket.windowExpiresAt} <= now() THEN 1 ELSE ${rateBucket.count} + 1 END`,
          windowExpiresAt: sql`CASE WHEN ${rateBucket.windowExpiresAt} <= now() THEN excluded.window_expires_at ELSE ${rateBucket.windowExpiresAt} END`,
        },
      })
      .returning({ count: rateBucket.count });
    return row!.count;
  }).catch((error) => {
    if (error instanceof QuillsWorkspaceUnavailable)
      throw new HTTPException(404, { message: "Workspace not found" });
    throw error;
  });
  if (count > rule.limit)
    throw new HTTPException(429, {
      message: "Too many attempts, try again later",
    });
}

export type PortalAccessDecision =
  | {
      granted: true;
      reason: "public" | "team" | "domain" | "segment";
    }
  | { granted: false; reason: "unauthenticated" | "unauthorized" };

const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

/**
 * What a portal caller may see: the private-portal gate. Fails closed on a malformed config.
 * The invite and widget grants of the source wait for portal invites and the widget handoff.
 */
export async function evaluatePortalAccess(
  db: Database,
  caller: QuillsCaller,
): Promise<PortalAccessDecision> {
  const [row] = await db
    .select({ portalConfig: settings.portalConfig })
    .from(settings)
    .limit(1);
  let access: Record<string, unknown> = {};
  try {
    const config: unknown = JSON.parse(row?.portalConfig || "{}");
    const value = (config as { access?: unknown } | null)?.access;
    access = value && typeof value === "object" ? { ...value } : {};
  } catch {
    access = { visibility: "private" };
  }
  if (access.visibility !== "private")
    return { granted: true, reason: "public" };
  const account = caller.account;
  if (!account) return { granted: false, reason: "unauthenticated" };
  if (account.member) return { granted: true, reason: "team" };
  if (account.emailVerified) {
    const domain = account.email.slice(account.email.lastIndexOf("@") + 1);
    if (strings(access.allowedDomains).includes(domain.toLowerCase()))
      return { granted: true, reason: "domain" };
    const allowed = strings(access.allowedSegmentIds)
      .filter((id): id is SegmentId => isValidTypeId(id, "segment"))
      .slice(0, 100);
    if (caller.principalId && allowed.length) {
      const [member] = await db
        .select({ id: userSegments.segmentId })
        .from(userSegments)
        .innerJoin(segments, eq(segments.id, userSegments.segmentId))
        .where(
          and(
            eq(userSegments.principalId, caller.principalId),
            inArray(userSegments.segmentId, allowed),
            isNull(segments.deletedAt),
          ),
        )
        .limit(1);
      if (member) return { granted: true, reason: "segment" };
    }
  }
  return { granted: false, reason: "unauthorized" };
}
