import { and, eq, gt, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z } from "../../openapi";
import { principal, settings } from "../../database/quills/schema/auth";
import { kvStore } from "../../database/quills/schema/kv";
import type { QuillsCaller } from "../framework/audience";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { contactEmailCode, safeEqual } from "../framework/signed";
import { realEmail } from "../directory/customer";

// An anonymous widget visitor's contact address (principal.contact_email), the one address Quills
// owns: a portal customer's is the Kaneo account's, an identified visitor's comes from the host's
// signed token. Changing it takes a code mailed to the new address, and, when an address is set,
// first a code mailed to the current one. Codes are derived, never stored (framework/signed.ts),
// expire after 15 minutes, allow 5 tries and work once. The mail worker sends them after commit.

const TTL_MS = 15 * 60 * 1000;
const MAX_TRIES = 5;
/** Code mails per visitor and hour, besides the per-client rate limit of each route. */
const MAX_SENDS = 5;
type Purpose = "current" | "change";
type Pending = { email: string; nonce: string; tries: number };
type PrincipalId = NonNullable<QuillsCaller["principalId"]>;
const keyOf = (purpose: Purpose, principalId: string) =>
  `contact-email:${purpose}:${principalId}`;

/** The address in the form it is stored, or null when the system would not send to it. */
function acceptable(input: string) {
  const email = input.trim().toLowerCase();
  return email.length <= 254 &&
    /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email) &&
    realEmail(email)
    ? email
    : null;
}

/** The caller's anonymous principal and its contact address. 403 for anyone else. */
async function anonymousCaller(db: Database, caller: QuillsCaller) {
  const [row] = caller.principalId
    ? await db
        .select({
          id: principal.id,
          type: principal.type,
          contactEmail: principal.contactEmail,
        })
        .from(principal)
        .where(eq(principal.id, caller.principalId))
        .for("update")
    : [];
  if (row?.type !== "anonymous")
    throw new HTTPException(403, {
      message: "Only an anonymous visitor sets a contact address here",
    });
  return { id: row.id, current: realEmail(row.contactEmail) };
}

async function pending(db: Database, purpose: Purpose, id: PrincipalId) {
  const [row] = await db
    .select({ value: kvStore.value })
    .from(kvStore)
    .where(
      and(
        eq(kvStore.workspaceKey, "_"),
        eq(kvStore.key, keyOf(purpose, id)),
        gt(kvStore.expiresAt, sql`now()`),
      ),
    )
    .for("update");
  return row?.value as Pending | undefined;
}

/**
 * The live request of `purpose` and its code, or undefined. The mail worker reads it at send time
 * (jobs/fanout.ts), so a request that ended or was replaced mails its current state or nothing.
 */
export async function pendingCode(
  db: Database,
  purpose: string,
  id: PrincipalId,
) {
  if (purpose !== "current" && purpose !== "change") return undefined;
  const request = await pending(db, purpose, id);
  const [config] = await db
    .select({ secret: settings.widgetSecret })
    .from(settings);
  if (!request || !config?.secret) return undefined;
  const code = contactEmailCode(config.secret, {
    principalId: id,
    purpose,
    email: request.email,
    nonce: request.nonce,
  });
  return { ...request, code };
}

/**
 * Spends one try of a pending code. True when `code` matches; the request is then gone. A wrong
 * code counts (the caller commits it), and the fifth wrong one ends the request.
 */
async function check(
  db: Database,
  purpose: Purpose,
  id: PrincipalId,
  email: string,
  code: string,
) {
  const request = await pendingCode(db, purpose, id);
  if (!request) return false;
  const ok = request.email === email && safeEqual(code, request.code);
  const where = and(
    eq(kvStore.workspaceKey, "_"),
    eq(kvStore.key, keyOf(purpose, id)),
  );
  if (ok || request.tries + 1 >= MAX_TRIES)
    await db.delete(kvStore).where(where);
  else
    await db
      .update(kvStore)
      .set({
        // The code itself is never stored.
        value: {
          email: request.email,
          nonce: request.nonce,
          tries: request.tries + 1,
        },
      })
      .where(where);
  return ok;
}

/** Stores a new code request for `email` and counts the mail. 429 past the hourly budget. */
async function requestCode(
  db: Database,
  purpose: Purpose,
  id: PrincipalId,
  email: string,
) {
  const [sends] = await db
    .insert(kvStore)
    .values({
      workspaceKey: "_",
      key: `contact-email:sends:${id}`,
      value: { count: 1 },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    .onConflictDoUpdate({
      target: [kvStore.workspaceId, kvStore.workspaceKey, kvStore.key],
      set: {
        value: sql`CASE WHEN ${kvStore.expiresAt} <= now() THEN '{"count":1}'::jsonb ELSE jsonb_build_object('count', (${kvStore.value}->>'count')::int + 1) END`,
        expiresAt: sql`CASE WHEN ${kvStore.expiresAt} <= now() THEN excluded.expires_at ELSE ${kvStore.expiresAt} END`,
      },
    })
    .returning({ value: kvStore.value });
  if (
    ((sends?.value as { count?: number } | undefined)?.count ?? 0) > MAX_SENDS
  )
    throw new HTTPException(429, {
      message: "Too many codes requested, try again later",
    });
  const nonce = Buffer.from(
    crypto.getRandomValues(new Uint8Array(16)),
  ).toString("base64url");
  const value: Pending = { email, nonce, tries: 0 };
  await db
    .insert(kvStore)
    .values({
      workspaceKey: "_",
      key: keyOf(purpose, id),
      value,
      expiresAt: new Date(Date.now() + TTL_MS),
    })
    .onConflictDoUpdate({
      target: [kvStore.workspaceId, kvStore.workspaceKey, kvStore.key],
      set: { value, expiresAt: new Date(Date.now() + TTL_MS) },
    });
}

const codeRequested =
  (purpose: Purpose) =>
  (_: unknown, result: { ok: boolean; principalId: string }) =>
    result.ok && {
      type: "user.contact_email_code_requested" as const,
      entityType: "principal" as const,
      entityId: result.principalId,
      payload: { purpose },
    };
const outcome = z.object({
  ok: z.boolean(),
  /** Why nothing changed: a missing or wrong code, or the address already set. */
  reason: z
    .enum(["current_code_required", "invalid_code", "same_email"])
    .nullable(),
  principalId: z.string(),
});

const state = defineQuillsRoute({
  audience: "widget",
  method: "get",
  path: "/widget/contact-email",
  operationId: "getQuillsEmailChangeState",
  summary: "Get the anonymous visitor's contact address and change state",
  action: "read",
  response: z.object({
    currentEmail: z.string().nullable(),
    requiresCurrentCode: z.boolean(),
    pendingEmail: z.string().nullable(),
  }),
  responseDescription: "The contact address and a pending change",
  errors: { 403: "Not an anonymous widget visitor" },
  handler: async ({ db, caller }) => {
    const me = await anonymousCaller(db, caller);
    return {
      currentEmail: me.current,
      requiresCurrentCode: me.current !== null,
      pendingEmail: (await pending(db, "change", me.id))?.email ?? null,
    };
  },
});

const currentCode = defineQuillsRoute({
  audience: "widget",
  rateLimit: { limit: 10, windowSeconds: 15 * 60 },
  method: "post",
  path: "/widget/contact-email/current-code",
  operationId: "sendQuillsCurrentAddressCode",
  summary: "Mail a code to the current contact address",
  description:
    "The first step of a change when an address is set: the code proves the visitor holds it. The mail goes out after this request commits.",
  action: "update",
  response: outcome,
  responseDescription: "The request was stored",
  errors: {
    403: "Not an anonymous widget visitor",
    409: "No contact address is set",
  },
  event: codeRequested("current"),
  handler: async ({ db, caller }) => {
    const me = await anonymousCaller(db, caller);
    if (!me.current)
      throw new HTTPException(409, { message: "No contact address is set" });
    await requestCode(db, "current", me.id, me.current);
    return { ok: true, reason: null, principalId: me.id };
  },
});

const request = defineQuillsRoute({
  audience: "widget",
  rateLimit: { limit: 10, windowSeconds: 15 * 60 },
  method: "post",
  path: "/widget/contact-email",
  operationId: "requestQuillsEmailChange",
  summary: "Request a contact address change",
  description:
    "Mails a code to the new address after this request commits. With an address set, `currentCode` (from the current-code step) must be right first; it works once.",
  action: "update",
  body: z.object({
    email: z.string().max(320),
    currentCode: z.string().max(16).optional(),
  }),
  response: outcome,
  responseDescription: "Whether the code was requested",
  errors: {
    400: "Not an address the system sends to",
    403: "Not an anonymous widget visitor",
  },
  event: codeRequested("change"),
  handler: async ({ db, caller, body }) => {
    const me = await anonymousCaller(db, caller);
    const email = acceptable(body.email);
    if (!email)
      throw new HTTPException(400, { message: "Enter a valid email address" });
    const answer = (reason: z.output<typeof outcome>["reason"]) => ({
      ok: reason === null,
      reason,
      principalId: me.id,
    });
    if (me.current === email) return answer("same_email");
    if (me.current) {
      if (!body.currentCode) return answer("current_code_required");
      if (!(await check(db, "current", me.id, me.current, body.currentCode)))
        return answer("invalid_code");
    }
    await requestCode(db, "change", me.id, email);
    return answer(null);
  },
});

const confirm = defineQuillsRoute({
  audience: "widget",
  rateLimit: { limit: 20, windowSeconds: 15 * 60 },
  method: "post",
  path: "/widget/contact-email/confirm",
  operationId: "confirmQuillsEmailChange",
  summary: "Confirm a contact address change with its code",
  description:
    "Sets the contact address. A wrong code counts as a try; after 5, or 15 minutes, request a new code.",
  action: "update",
  body: z.object({
    email: z.string().max(320),
    code: z.string().min(1).max(16),
  }),
  response: z.object({
    ok: z.boolean(),
    email: z.string().nullable(),
    principalId: z.string(),
  }),
  responseDescription: "Whether the address changed",
  errors: { 403: "Not an anonymous widget visitor" },
  event: (_input, result) =>
    result.ok && {
      type: "user.updated",
      entityType: "principal",
      entityId: result.principalId,
      payload: { field: "contactEmail" },
    },
  handler: async ({ db, caller, body }) => {
    const me = await anonymousCaller(db, caller);
    const email = acceptable(body.email);
    if (!email || !(await check(db, "change", me.id, email, body.code)))
      return { ok: false, email: null, principalId: me.id };
    await db
      .update(principal)
      .set({ contactEmail: email })
      .where(eq(principal.id, me.id));
    return { ok: true, email, principalId: me.id };
  },
});

export default apiRouter()
  .openapi(...state)
  .openapi(...currentCode)
  .openapi(...request)
  .openapi(...confirm);
