import { and, eq, gt, isNull } from "drizzle-orm";
import { apiRouter, nullableResponseTimestamp, z } from "../../../../openapi";
import { unsubscribeTokens } from "../../../../database/quills/schema/notifications";
import { statusSubscriptions } from "../../../../database/quills/schema/status";
import {
  defineQuillsRoute,
  type Database,
} from "../../../framework/define-route";
import { hashToken, type QuillsCaller } from "../../../framework/audience";
import { idList } from "../../../feedback/schemas";
import { notFound, openStatusPage, visibleComponents } from "./visibility";

// A visitor's own status-page subscription. As in the source, a subscriber is always a principal:
// a signed-in portal customer subscribes and unsubscribes here, and a status email's link carries
// a one-time unsubscribe token. Only the SHA-256 hash of a token is stored; it expires after 30
// days and works once. The source has no email-only (double opt-in) subscription.

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STATUS_ACTION = "unsubscribe_status";

const subscription = z.object({
  subscribed: z.boolean(),
  scope: z.enum(["page", "components"]),
  componentIds: z.array(z.string()),
  unsubscribedAt: nullableResponseTimestamp,
});

async function stateOf(db: Database, principalId: QuillsCaller["principalId"]) {
  const [row] = principalId
    ? await db
        .select({
          scope: statusSubscriptions.scope,
          componentIds: statusSubscriptions.componentIds,
          unsubscribedAt: statusSubscriptions.unsubscribedAt,
        })
        .from(statusSubscriptions)
        .where(eq(statusSubscriptions.principalId, principalId))
    : [];
  return row
    ? { subscribed: row.unsubscribedAt === null, ...row }
    : {
        subscribed: false,
        scope: "page" as const,
        componentIds: [],
        unsubscribedAt: null,
      };
}

/** Opts a principal out, keeping the row (and its source) as the record. True when this changed it. */
async function optOut(db: Database, principalId: QuillsCaller["principalId"]) {
  if (!principalId) return false;
  const rows = await db
    .update(statusSubscriptions)
    .set({ unsubscribedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(statusSubscriptions.principalId, principalId),
        isNull(statusSubscriptions.unsubscribedAt),
      ),
    )
    .returning({ id: statusSubscriptions.id });
  return rows.length > 0;
}

/**
 * Mints a status unsubscribe link token for a subscriber and stores only its hash. For the status
 * mail sender: P4 delivers mail to teammates only, so no status mail carries one yet.
 */
export async function mintStatusUnsubscribeToken(
  db: Database,
  principalId: NonNullable<QuillsCaller["principalId"]>,
  expiresAt = new Date(Date.now() + TOKEN_TTL_MS),
) {
  const token = Buffer.from(
    globalThis.crypto.getRandomValues(new Uint8Array(32)),
  ).toString("base64url");
  await db.insert(unsubscribeTokens).values({
    token: hashToken(token),
    principalId,
    action: STATUS_ACTION,
    expiresAt,
  });
  return token;
}

const changeEvent =
  (type: "status.subscribed" | "status.unsubscribed", source: string) =>
  ({ workspaceId }: { workspaceId: string }, result: { changed: boolean }) =>
    result.changed && {
      type,
      entityType: "workspace" as const,
      entityId: workspaceId,
      payload: { source },
    };

const mine = defineQuillsRoute({
  audience: "portal",
  method: "get",
  path: "/status/subscription",
  operationId: "getQuillsMyStatusSubscription",
  summary: "Get the caller's status-page subscription",
  description:
    "Works while the page is closed, so a subscriber can always see their state.",
  action: "read",
  response: subscription,
  responseDescription: "The caller's subscription",
  handler: async ({ db, caller }) => stateOf(db, caller.principalId),
});

const subscribe = defineQuillsRoute({
  audience: "portal",
  ensureCustomer: true,
  rateLimit: { limit: 20, windowSeconds: 600 },
  method: "put",
  path: "/status/subscription",
  operationId: "subscribeQuillsStatus",
  summary: "Subscribe the caller to status-page updates",
  description:
    "The whole page, or the listed components the caller can see. A new call replaces the scope and clears an earlier unsubscribe.",
  action: "update",
  body: z
    .object({
      scope: z.enum(["page", "components"]),
      componentIds: idList("status_component").optional(),
    })
    .refine(
      (body) => body.scope === "page" || Boolean(body.componentIds?.length),
      "A components subscription lists at least one component",
    ),
  response: subscription.extend({ changed: z.boolean() }),
  responseDescription: "The caller's subscription",
  errors: { 404: "Status page or component not found" },
  event: changeEvent("status.subscribed", "self_serve"),
  handler: async ({ db, caller, body }) => {
    const { segmentIds } = await openStatusPage(db, caller);
    const componentIds =
      body.scope === "components" ? (body.componentIds ?? []) : [];
    const visible = new Set<string>(
      (await visibleComponents(db, segmentIds)).map((c) => c.id),
    );
    if (componentIds.some((id) => !visible.has(id)))
      throw notFound("Component");
    const before = await stateOf(db, caller.principalId);
    await db
      .insert(statusSubscriptions)
      .values({
        principalId: caller.principalId!,
        scope: body.scope,
        componentIds,
        source: "self_serve",
      })
      .onConflictDoUpdate({
        target: [
          statusSubscriptions.workspaceId,
          statusSubscriptions.principalId,
        ],
        set: {
          scope: body.scope,
          componentIds,
          unsubscribedAt: null,
          updatedAt: new Date(),
        },
      });
    const after = await stateOf(db, caller.principalId);
    return {
      ...after,
      changed: JSON.stringify(before) !== JSON.stringify(after),
    };
  },
});

const unsubscribe = defineQuillsRoute({
  audience: "portal",
  method: "delete",
  path: "/status/subscription",
  operationId: "unsubscribeQuillsStatus",
  summary: "Unsubscribe the caller from status-page updates",
  description:
    "Keeps the row as the opt-out record. Works while the page is closed.",
  action: "update",
  response: subscription.extend({ changed: z.boolean() }),
  responseDescription: "The caller's subscription",
  event: changeEvent("status.unsubscribed", "self_serve"),
  handler: async ({ db, caller }) => {
    const changed = await optOut(db, caller.principalId);
    return { ...(await stateOf(db, caller.principalId)), changed };
  },
});

const byToken = defineQuillsRoute({
  audience: "public",
  rateLimit: { limit: 20, windowSeconds: 600 },
  method: "post",
  path: "/status/unsubscribe",
  operationId: "unsubscribeQuillsStatusByToken",
  summary: "Unsubscribe through a status email's one-time link token",
  description:
    "200 for every token: `changed` is false for an unknown, used or expired token and for a subscriber who already left. Works while the page is closed.",
  action: "update",
  body: z.object({ token: z.string().min(20).max(200) }),
  response: z.object({ changed: z.boolean() }),
  responseDescription: "Whether this request unsubscribed someone",
  event: changeEvent("status.unsubscribed", "token"),
  handler: async ({ db, body }) => {
    const [spent] = await db
      .update(unsubscribeTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(unsubscribeTokens.token, hashToken(body.token)),
          eq(unsubscribeTokens.action, STATUS_ACTION),
          isNull(unsubscribeTokens.usedAt),
          gt(unsubscribeTokens.expiresAt, new Date()),
        ),
      )
      .returning({ principalId: unsubscribeTokens.principalId });
    return { changed: spent ? await optOut(db, spent.principalId) : false };
  },
});

export default apiRouter()
  .openapi(...mine)
  .openapi(...subscribe)
  .openapi(...unsubscribe)
  .openapi(...byToken);
