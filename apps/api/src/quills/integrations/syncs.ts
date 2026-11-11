import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { isTypeId, type TypeId } from "@kaneo/ids";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import {
  integrationSyncActions as actions,
  integrationSyncAttempts as attempts,
  integrationSyncOperations as operations,
} from "../../database/quills/schema/integration-sync";
import { integrations } from "../../database/quills/schema/integrations";
import { postComments, posts } from "../../database/quills/schema/posts";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { boardVisible, loadProjects } from "../feedback/visibility";
import { httpsUrl, installationOf, syncError } from "./catalog";
import { findIntegration, integrationParams } from "./connect";

const syncAction = z.enum(["retry", "cancel"]);
type Op = typeof operations.$inferSelect;

/**
 * A `running` operation whose lease expired belongs to an attempt that stopped after its claim, for example
 * on the job's last attempt: it may have sent, so it is uncertain. No job comes back for it.
 */
function effective(op: Op) {
  return op.state === "running" &&
    (!op.leaseExpiresAt || op.leaseExpiresAt.getTime() <= Date.now())
    ? { state: "uncertain", errorCode: "outcome_unknown" }
    : { state: op.state, errorCode: op.errorCode };
}

/**
 * Recovery actions by state. Retry only when the outcome is certainly "not delivered" and the operation
 * belongs to the active connection it was made for. An uncertain operation is never sent again; cancel
 * only records that a teammate checked it.
 */
export function syncActions(op: Op, current: boolean) {
  const { state } = effective(op);
  if (state === "failed" || state === "auth_required")
    return current ? (["retry", "cancel"] as const) : (["cancel"] as const);
  if (
    ["queued", "retry_wait", "uncertain"].includes(state) &&
    !op.cancelRequested
  )
    return ["cancel"] as const;
  return [] as const;
}

/** The installation that may run a retry: the connection's current one, while it is active. */
async function activeInstallation(db: Database, integrationId: string) {
  if (!isTypeId(integrationId, "integration")) return null;
  const [row] = await db
    .select({
      id: integrations.id,
      status: integrations.status,
      connectedAt: integrations.connectedAt,
    })
    .from(integrations)
    .where(eq(integrations.id, integrationId));
  return row?.status === "active" ? installationOf(row) : null;
}

const syncItem = z
  .object({
    id: z.string(),
    provider: z.string(),
    direction: z.string(),
    kind: z.string(),
    state: z.string(),
    version: z.number(),
    sourceType: z.string(),
    post: z.object({ id: z.string(), title: z.string() }).nullable(),
    destination: z.string(),
    remoteUrl: z.string().nullable(),
    remoteDisplayId: z.string().nullable(),
    attempts: z.number(),
    error: z.string().nullable(),
    cancelRequested: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    actions: z.array(syncAction),
  })
  .openapi("QuillsIntegrationSync");

/** The post each operation is about, when the caller can see its board. Deleted posts still count. */
async function visiblePosts(db: Database, projects: string[], ops: Op[]) {
  const ids = (type: string, prefix: "post" | "post_comment") =>
    ops
      .filter((op) => op.sourceType === type)
      .map((op) => op.sourceId)
      .filter((id) => isTypeId(id, prefix));
  const postIds = ids("post", "post") as TypeId<"post">[];
  const commentIds = ids("comment", "post_comment") as TypeId<"post_comment">[];
  const found = new Map<string, { id: string; title: string }>();
  if (postIds.length)
    for (const row of await db
      .select({ id: posts.id, title: posts.title })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .where(and(inArray(posts.id, postIds), boardVisible(projects))))
      found.set(row.id, row);
  if (commentIds.length)
    for (const row of await db
      .select({ key: postComments.id, id: posts.id, title: posts.title })
      .from(postComments)
      .innerJoin(posts, eq(posts.id, postComments.postId))
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .where(and(inArray(postComments.id, commentIds), boardVisible(projects))))
      found.set(row.key, { id: row.id, title: row.title });
  return found;
}

function view(
  op: Op,
  post: { id: string; title: string } | undefined,
  installation: string | null,
) {
  const result = (op.result ?? {}) as Record<string, unknown>;
  const { state, errorCode } = effective(op);
  return {
    id: op.id,
    provider: op.provider,
    direction: op.direction,
    kind: op.kind,
    state,
    version: op.version,
    sourceType: op.sourceType,
    post: post ?? null,
    destination: op.destinationKey,
    remoteUrl: post ? httpsUrl(result.externalUrl) : null,
    remoteDisplayId:
      post && typeof result.externalId === "string" ? result.externalId : null,
    attempts: op.attempts,
    error: syncError(errorCode),
    cancelRequested: op.cancelRequested,
    createdAt: op.createdAt.toISOString(),
    updatedAt: op.updatedAt.toISOString(),
    // A source the caller cannot see offers no action.
    actions: post ? [...syncActions(op, op.installation === installation)] : [],
  };
}

const syncParams = z.object({ syncId: z.uuid() });
const errors = { 403: "Insufficient permission", 404: "Sync not found" };
const notFound = () => new HTTPException(404, { message: errors[404] });

/** An operation whose post the caller can see. 404 otherwise, so a hidden source looks like a missing one. */
async function findOperation(
  db: Database,
  projects: string[],
  id: string,
  lock = false,
) {
  const query = db.select().from(operations).where(eq(operations.id, id));
  const [op] = lock ? await query.for("update") : await query;
  const post = op && (await visiblePosts(db, projects, [op])).get(op.sourceId);
  if (!op || !post) throw notFound();
  return {
    op,
    post,
    installation: await activeInstallation(db, op.integrationId),
  };
}

const filters = {
  attention: sql`${operations.state} IN ('failed','auth_required','uncertain')`,
  progress: sql`${operations.state} IN ('queued','running','retry_wait')`,
  successful: eq(operations.state, "succeeded"),
};

const listSyncs = defineQuillsRoute({
  method: "get",
  path: "/integrations/{integrationId}/syncs",
  operationId: "listQuillsIntegrationSyncHistory",
  summary: "List the sync history of an integration",
  description:
    "Newest first. A source on a board that the caller cannot see is listed without its post and actions. Pass the last item's ID as `cursor` for the next page.",
  action: "read",
  params: integrationParams,
  query: z.object({
    filter: z
      .enum(["all", "attention", "progress", "successful"])
      .default("all"),
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  }),
  load: loadProjects,
  response: z.object({
    items: z.array(syncItem),
    nextCursor: z.string().nullable(),
  }),
  responseDescription: "Sync operations",
  errors: { 403: errors[403], 404: "Integration not found" },
  handler: async ({ db, params, query, loaded: projects }) => {
    const integration = await findIntegration(db, params.integrationId);
    const installation =
      integration.status === "active" ? installationOf(integration) : null;
    const rows = await db
      .select()
      .from(operations)
      .where(
        and(
          eq(operations.integrationId, params.integrationId),
          query.filter === "all" ? undefined : filters[query.filter],
          query.cursor
            ? sql`(${operations.createdAt}, ${operations.id}) < (SELECT o.created_at, o.id FROM quills.integration_sync_operations o WHERE o.id = ${query.cursor}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(operations.createdAt), desc(operations.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const visible = await visiblePosts(db, projects, page);
    return {
      items: page.map((op) => view(op, visible.get(op.sourceId), installation)),
      nextCursor: rows.length > query.limit ? page.at(-1)!.id : null,
    };
  },
});

const inspectSync = defineQuillsRoute({
  method: "get",
  path: "/integration-syncs/{syncId}",
  operationId: "inspectQuillsIntegrationSync",
  summary: "Inspect a sync operation and its attempts",
  action: "read",
  params: syncParams,
  load: loadProjects,
  response: z.object({
    item: syncItem,
    attempts: z.array(
      z.object({
        number: z.number(),
        state: z.string(),
        error: z.string().nullable(),
        startedAt: z.string(),
        finishedAt: z.string().nullable(),
      }),
    ),
  }),
  responseDescription: "The operation and its newest 50 attempts",
  errors,
  handler: async ({ db, params, loaded: projects }) => {
    const { op, post, installation } = await findOperation(
      db,
      projects,
      params.syncId,
    );
    const history = await db
      .select({
        number: attempts.number,
        state: attempts.state,
        errorCode: attempts.errorCode,
        startedAt: attempts.startedAt,
        finishedAt: attempts.finishedAt,
      })
      .from(attempts)
      .where(eq(attempts.operationId, op.id))
      .orderBy(desc(attempts.number))
      .limit(50);
    return {
      item: view(op, post, installation),
      attempts: history.map((attempt) => ({
        number: attempt.number,
        state: attempt.state,
        error: syncError(attempt.errorCode),
        startedAt: attempt.startedAt.toISOString(),
        finishedAt: attempt.finishedAt?.toISOString() ?? null,
      })),
    };
  },
});

const recoverSync = defineQuillsRoute({
  method: "post",
  path: "/integration-syncs/{syncId}/actions",
  operationId: "recoverQuillsIntegrationSync",
  summary: "Retry or cancel a sync operation",
  description:
    "`retry` is available only for `failed` and `auth_required` (certainly not delivered) on the active connection the sync was made for. An `uncertain` operation is never retried. A repeated `idempotencyKey` returns the current state and changes nothing. The worker enqueues a retry after this request commits.",
  action: "manage_settings",
  params: syncParams,
  body: z.object({
    action: syncAction,
    version: z.number().int().positive(),
    idempotencyKey: z.uuid(),
  }),
  load: loadProjects,
  response: z.object({ item: syncItem, replayed: z.boolean() }),
  responseDescription: "The operation after the action",
  errors: {
    ...errors,
    409: "The sync changed, the action is not available, or the original connection is gone",
  },
  event: ({ params, body }, result) =>
    !result.replayed && {
      type: "integration_sync.recovered",
      entityType: "integration_sync",
      entityId: params.syncId,
      payload: { action: body.action },
    },
  handler: async ({ db, actor, params, body, loaded: projects }) => {
    // The row lock serializes concurrent actions on one operation.
    const { op, post, installation } = await findOperation(
      db,
      projects,
      params.syncId,
      true,
    );
    const conflict = (message: string) => new HTTPException(409, { message });
    const [prior] = await db
      .select()
      .from(actions)
      .where(eq(actions.id, body.idempotencyKey));
    if (prior) {
      if (
        prior.operationId !== op.id ||
        prior.principalId !== actor.principalId ||
        prior.action !== body.action
      )
        throw conflict("Invalid recovery request");
      return { item: view(op, post, installation), replayed: true };
    }
    if (op.version !== body.version)
      throw conflict("This sync changed. Refresh and try again.");
    const current = op.installation === installation;
    if (!(syncActions(op, current) as readonly string[]).includes(body.action))
      throw conflict(
        body.action === "retry" && !current
          ? "The original connection is paused or replaced. This sync cannot run on another connection."
          : "This action is no longer available",
      );
    // A key reused at the same moment on another operation conflicts here, not in a 500.
    const recorded = await db
      .insert(actions)
      .values({
        id: body.idempotencyKey,
        operationId: op.id,
        action: body.action,
        principalId: actor.principalId,
      })
      .onConflictDoNothing()
      .returning({ id: actions.id });
    if (!recorded.length) throw conflict("Invalid recovery request");
    const now = new Date();
    const { state, errorCode } = effective(op);
    const keep = state === "uncertain";
    const retry = body.action === "retry";
    const [updated] = await db
      .update(operations)
      .set(
        retry
          ? {
              state: "queued",
              errorCode: null,
              finishedAt: null,
              dispatchedAt: null,
              cancelRequested: false,
              version: op.version + 1,
              updatedAt: now,
            }
          : {
              state: keep ? state : "cancelled",
              errorCode: keep ? errorCode : "cancelled_by_user",
              cancelRequested: true,
              leaseToken: null,
              leaseExpiresAt: null,
              finishedAt: op.finishedAt ?? now,
              version: op.version + 1,
              updatedAt: now,
            },
      )
      .where(eq(operations.id, op.id))
      .returning();
    return { item: view(updated!, post, installation), replayed: false };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listSyncs)
  .openapi(...inspectSync)
  .openapi(...recoverSync);
