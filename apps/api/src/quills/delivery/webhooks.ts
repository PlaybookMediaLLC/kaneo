import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { createId, type BoardId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import { events as eventsTable } from "../../database/quills/schema/events";
import { jobQueue } from "../../database/quills/schema/job-queue";
import { rateBucket } from "../../database/quills/schema/kv";
import { postComments } from "../../database/quills/schema/posts";
import {
  webhookDeliveries,
  webhooks,
} from "../../database/quills/schema/webhooks";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import {
  newSigningSecret,
  sendTestWebhook,
  validateWebhookUrl,
  webhookEvent,
} from "../framework/webhook-config";

// Every webhook route needs manage_settings: a target URL can carry the receiver's credentials.
const MAX_WEBHOOKS = 25;
const params = z.object({ webhookId: flexibleToTypeIdSchema("webhook") });
const url = z.url().max(2048);
const events = z.array(webhookEvent).min(1).max(50);
const boardIds = z.array(flexibleToTypeIdSchema("board")).max(50);
const webhook = z
  .object({
    id: z.string(),
    url: z.string(),
    events: z.array(z.string()),
    boardIds: z.array(z.string()).nullable(),
    status: z.enum(["active", "disabled"]),
    failureCount: z.number(),
    lastError: z.string().nullable(),
    lastTriggeredAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("QuillsWebhook");
const withSecret = z.object({ webhook, secret: z.string() });
const columns = {
  id: webhooks.id,
  url: webhooks.url,
  events: webhooks.events,
  boardIds: webhooks.boardIds,
  status: webhooks.status,
  failureCount: webhooks.failureCount,
  lastError: webhooks.lastError,
  lastTriggeredAt: webhooks.lastTriggeredAt,
  createdAt: webhooks.createdAt,
  updatedAt: webhooks.updatedAt,
};
type Row = Pick<typeof webhooks.$inferSelect, keyof typeof columns>;
const view = (row: Row) => ({
  ...row,
  lastTriggeredAt: row.lastTriggeredAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
const errors = { 403: "Insufficient permission", 404: "Webhook not found" };
const secretErrors = {
  ...errors,
  409: "Set NOTIFICATION_SECRET_ENCRYPTION_KEY first, or the webhook limit is reached",
};
const notFound = () => new HTTPException(404, { message: "Webhook not found" });
const live = (webhookId: Row["id"]) =>
  and(eq(webhooks.id, webhookId), isNull(webhooks.deletedAt));

/** Every board filter must be a live board of this workspace. */
async function checkBoards(db: Database, ids: BoardId[] | null | undefined) {
  const unique = [...new Set(ids ?? [])];
  if (!unique.length) return null;
  const [found] = await db
    .select({ n: count() })
    .from(boards)
    .where(and(inArray(boards.id, unique), isNull(boards.deletedAt)));
  if (found!.n !== unique.length)
    throw new HTTPException(404, { message: "Board not found" });
  return unique;
}

const listWebhooks = defineQuillsRoute({
  method: "get",
  path: "/webhooks",
  operationId: "listQuillsWebhooks",
  summary: "List Quills webhooks",
  action: "manage_settings",
  response: z.object({ webhooks: z.array(webhook) }),
  responseDescription: "Webhooks without their signing secrets",
  errors: { 403: errors[403] },
  handler: async ({ db }) => ({
    webhooks: (
      await db
        .select(columns)
        .from(webhooks)
        .where(isNull(webhooks.deletedAt))
        .orderBy(desc(webhooks.createdAt))
        .limit(MAX_WEBHOOKS)
    ).map(view),
  }),
});

const getWebhook = defineQuillsRoute({
  method: "get",
  path: "/webhooks/{webhookId}",
  operationId: "getQuillsWebhook",
  summary: "Get a Quills webhook",
  action: "manage_settings",
  params,
  response: z.object({ webhook }),
  responseDescription: "The webhook without its signing secret",
  errors,
  handler: async ({ db, params }) => {
    const [row] = await db
      .select(columns)
      .from(webhooks)
      .where(live(params.webhookId));
    if (!row) throw notFound();
    return { webhook: view(row) };
  },
});

const createWebhook = defineQuillsRoute({
  method: "post",
  path: "/webhooks",
  operationId: "createQuillsWebhook",
  summary: "Create a Quills webhook",
  description:
    "Returns the signing secret once. Deliveries are signed with HMAC-SHA256 over the x-kaneo-timestamp value, a dot and the body, in the x-kaneo-signature header.",
  action: "manage_settings",
  body: z.object({ url, events, boardIds: boardIds.optional() }),
  // DNS and secret generation run after the permission checks and outside the transaction.
  load: async ({ body }) => ({
    url: await validateWebhookUrl(body.url),
    ...newSigningSecret(),
  }),
  response: withSecret,
  responseDescription: "The webhook and its signing secret, shown only here",
  errors: secretErrors,
  allowKeys: ["secret"],
  event: (_input, result) => ({
    type: "webhook.created",
    entityType: "webhook",
    entityId: result.webhook.id,
  }),
  handler: async ({ db, actor, body, loaded }) => {
    const filter = await checkBoards(db, body.boardIds);
    // ponytail: a soft cap; two concurrent creates can pass it by one.
    const [existing] = await db
      .select({ n: count() })
      .from(webhooks)
      .where(isNull(webhooks.deletedAt));
    if (existing!.n >= MAX_WEBHOOKS)
      throw new HTTPException(409, {
        message: `A workspace can have ${MAX_WEBHOOKS} webhooks`,
      });
    const [row] = await db
      .insert(webhooks)
      .values({
        createdById: actor.principalId,
        url: loaded.url,
        secret: loaded.encrypted,
        events: [...new Set(body.events)],
        boardIds: filter,
      })
      .returning(columns);
    return { webhook: view(row!), secret: loaded.secret };
  },
});

const updateWebhook = defineQuillsRoute({
  method: "patch",
  path: "/webhooks/{webhookId}",
  operationId: "updateQuillsWebhook",
  summary: "Update a Quills webhook",
  description: "Enabling a webhook resets its failure count.",
  action: "manage_settings",
  params,
  body: z
    .object({
      url: url.optional(),
      events: events.optional(),
      boardIds: boardIds.nullable().optional(),
      status: z.enum(["active", "disabled"]).optional(),
    })
    .refine((value) => Object.keys(value).length > 0, "Nothing to update"),
  load: async ({ body }) =>
    body.url ? await validateWebhookUrl(body.url) : undefined,
  response: z.object({ webhook }),
  responseDescription: "The updated webhook",
  errors,
  event: ({ params }) => ({
    type: "webhook.updated",
    entityType: "webhook",
    entityId: params.webhookId,
  }),
  handler: async ({ db, params, body, loaded }) => {
    const [row] = await db
      .update(webhooks)
      .set({
        url: loaded,
        events: body.events && [...new Set(body.events)],
        boardIds:
          body.boardIds === undefined
            ? undefined
            : await checkBoards(db, body.boardIds),
        status: body.status,
        ...(body.status === "active" && { failureCount: 0, lastError: null }),
        updatedAt: new Date(),
      })
      .where(live(params.webhookId))
      .returning(columns);
    if (!row) throw notFound();
    return { webhook: view(row) };
  },
});

const deleteWebhook = defineQuillsRoute({
  method: "delete",
  path: "/webhooks/{webhookId}",
  operationId: "deleteQuillsWebhook",
  summary: "Delete a Quills webhook",
  description: "Soft delete. Queued deliveries for it are skipped.",
  action: "manage_settings",
  params,
  response: z.object({ deleted: z.boolean() }),
  responseDescription: "Webhook deleted",
  errors,
  event: ({ params }) => ({
    type: "webhook.deleted",
    entityType: "webhook",
    entityId: params.webhookId,
  }),
  handler: async ({ db, params }) => {
    const rows = await db
      .update(webhooks)
      .set({ deletedAt: new Date() })
      .where(live(params.webhookId))
      .returning({ id: webhooks.id });
    if (!rows.length) throw notFound();
    return { deleted: true };
  },
});

const rotateSecret = defineQuillsRoute({
  method: "post",
  path: "/webhooks/{webhookId}/rotate",
  operationId: "rotateQuillsWebhookSecret",
  summary: "Rotate a Quills webhook signing secret",
  description:
    "Returns the new secret once. Queued deliveries are signed with it.",
  action: "manage_settings",
  params,
  load: async () => newSigningSecret(),
  response: withSecret,
  responseDescription:
    "The webhook and its new signing secret, shown only here",
  errors: secretErrors,
  allowKeys: ["secret"],
  event: ({ params }) => ({
    type: "webhook.secret_rotated",
    entityType: "webhook",
    entityId: params.webhookId,
  }),
  handler: async ({ db, params, loaded }) => {
    const [row] = await db
      .update(webhooks)
      .set({ secret: loaded.encrypted, updatedAt: new Date() })
      .where(live(params.webhookId))
      .returning(columns);
    if (!row) throw notFound();
    return { webhook: view(row), secret: loaded.secret };
  },
});

const deliverySchema = z
  .object({
    id: z.string(),
    webhookId: z.string(),
    eventId: z.string(),
    eventType: z.string(),
    attempt: z.number(),
    status: z.enum(["succeeded", "failed", "retrying"]),
    httpStatus: z.number().nullable(),
    durationMs: z.number().nullable(),
    responseSnippet: z.string().nullable(),
    error: z.string().nullable(),
    deliveredAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("QuillsWebhookDelivery");

const deliveryView = (row: typeof webhookDeliveries.$inferSelect) => ({
  id: row.id,
  webhookId: row.webhookId,
  eventId: row.eventId,
  eventType: row.eventType,
  attempt: row.attempt,
  status: row.status,
  httpStatus: row.httpStatus,
  durationMs: row.durationMs,
  responseSnippet: row.responseSnippet,
  error: row.error,
  deliveredAt: row.deliveredAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

const listDeliveries = defineQuillsRoute({
  method: "get",
  path: "/webhooks/{webhookId}/deliveries",
  operationId: "listQuillsWebhookDeliveries",
  summary: "List recent delivery attempts for a webhook (#330)",
  action: "manage_settings",
  params,
  query: z.object({
    status: z.enum(["succeeded", "failed", "retrying"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  }),
  response: z.object({
    deliveries: z.array(deliverySchema),
    total: z.number(),
  }),
  responseDescription: "Recent delivery attempts, newest first",
  errors,
  handler: async ({ db, params, query }) => {
    const [hook] = await db
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(live(params.webhookId));
    if (!hook) throw notFound();
    const where = query.status
      ? and(
          eq(webhookDeliveries.webhookId, params.webhookId),
          eq(webhookDeliveries.status, query.status),
        )
      : eq(webhookDeliveries.webhookId, params.webhookId);
    const rows = await db
      .select()
      .from(webhookDeliveries)
      .where(where)
      .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
      .limit(query.limit)
      .offset(query.offset);
    const [total] = await db
      .select({ n: count() })
      .from(webhookDeliveries)
      .where(where);
    return {
      deliveries: rows.map(deliveryView),
      total: total?.n ?? 0,
    };
  },
});

async function enforceWebhookRateLimit(
  db: Database,
  key: string,
  limit: number,
  windowSeconds: number,
) {
  const [bucket] = await db
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
    .returning({ count: rateBucket.count });
  if ((bucket?.count ?? 0) > limit) {
    throw new HTTPException(429, {
      message: "Too many webhook requests; try again shortly",
    });
  }
}

const testWebhook = defineQuillsRoute({
  method: "post",
  path: "/webhooks/{webhookId}/test",
  operationId: "testQuillsWebhook",
  summary: "Send a signed synthetic test event to a webhook (#330)",
  description:
    "Fires a single signed `webhook.test` POST outside any database transaction and logs the result in webhook_deliveries.",
  action: "manage_settings",
  params,
  prepare: async ({ db, params }) => {
    const [hook] = await db
      .select({ id: webhooks.id, url: webhooks.url, secret: webhooks.secret })
      .from(webhooks)
      .where(live(params.webhookId));
    if (!hook) throw notFound();
    await enforceWebhookRateLimit(db, `webhook-test:${hook.id}`, 30, 600);
    return hook;
  },
  call: async (hook) => sendTestWebhook(hook),
  response: z.object({
    delivery: deliverySchema,
    ok: z.boolean(),
  }),
  responseDescription: "The test delivery result",
  errors,
  event: { none: "Synthetic webhook probe; writes only the delivery log row." },
  handler: async ({ db, params, called }) => {
    const now = new Date();
    const [row] = await db
      .insert(webhookDeliveries)
      .values({
        webhookId: params.webhookId,
        eventId: called.eventId,
        eventType: "webhook.test",
        attempt: 1,
        status: called.ok ? "succeeded" : "failed",
        httpStatus: called.httpStatus,
        durationMs: called.durationMs,
        responseSnippet: called.responseSnippet,
        error: called.error,
        deliveredAt: called.ok ? now : null,
      })
      .returning();
    return { delivery: deliveryView(row!), ok: called.ok };
  },
});

const replayDelivery = defineQuillsRoute({
  method: "post",
  path: "/webhooks/{webhookId}/deliveries/{deliveryId}/replay",
  operationId: "replayQuillsWebhookDelivery",
  summary: "Re-enqueue a single webhook delivery attempt (#330)",
  action: "manage_settings",
  params: params.extend({
    deliveryId: flexibleToTypeIdSchema("webhook_delivery"),
  }),
  response: z.object({ queued: z.boolean(), jobId: z.string() }),
  responseDescription: "Queued replay job ID",
  errors: {
    ...errors,
    400: "Synthetic test deliveries cannot be replayed",
    404: "Webhook or delivery not found",
    409: "Webhook is disabled",
  },
  event: { none: "Queues a replay job in quills.job_queue." },
  handler: async ({ db, params }) => {
    const [hook] = await db
      .select({ id: webhooks.id, status: webhooks.status })
      .from(webhooks)
      .where(live(params.webhookId));
    if (!hook) throw notFound();
    if (hook.status !== "active") {
      throw new HTTPException(409, {
        message: "Enable the webhook before replaying deliveries",
      });
    }
    await enforceWebhookRateLimit(db, `webhook-replay:${hook.id}`, 60, 600);
    const [delivery] = await db
      .select({
        id: webhookDeliveries.id,
        eventId: webhookDeliveries.eventId,
        eventType: webhookDeliveries.eventType,
      })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.id, params.deliveryId),
          eq(webhookDeliveries.webhookId, params.webhookId),
        ),
      );
    if (!delivery)
      throw new HTTPException(404, { message: "Webhook delivery not found" });
    if (delivery.eventType === "webhook.test") {
      throw new HTTPException(400, {
        message: "Synthetic test deliveries cannot be replayed; use Send test",
      });
    }
    const replayId = createId("job");
    await db
      .insert(jobQueue)
      .values({
        jobId: replayId,
        queue: "quills.webhook",
        payload: {
          eventId: delivery.eventId,
          webhookId: params.webhookId,
          replayId,
        },
        dedupeKey: `replay:${delivery.eventId}:${params.webhookId}:${replayId}`,
        maxAttempts: 10,
      })
      .onConflictDoNothing();
    return { queued: true, jobId: replayId };
  },
});

const replayFailed = defineQuillsRoute({
  method: "post",
  path: "/webhooks/{webhookId}/deliveries/replay-failed",
  operationId: "replayQuillsFailedWebhookDeliveries",
  summary: "Re-enqueue up to 50 recent failed deliveries for a webhook (#330)",
  action: "manage_settings",
  params,
  response: z.object({ queuedCount: z.number() }),
  responseDescription: "Number of failed events re-queued",
  errors: { ...errors, 409: "Webhook is disabled" },
  event: { none: "Queues replay jobs in quills.job_queue." },
  handler: async ({ db, params }) => {
    const [hook] = await db
      .select({ id: webhooks.id, status: webhooks.status })
      .from(webhooks)
      .where(live(params.webhookId));
    if (!hook) throw notFound();
    if (hook.status !== "active") {
      throw new HTTPException(409, {
        message: "Enable the webhook before replaying deliveries",
      });
    }
    await enforceWebhookRateLimit(
      db,
      `webhook-replay-failed:${hook.id}`,
      10,
      600,
    );
    // Only replay real events whose most recent delivery attempt for this webhook is still failed.
    const failedRows = await db
      .select({ eventId: webhookDeliveries.eventId })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.webhookId, params.webhookId),
          eq(webhookDeliveries.status, "failed"),
          ne(webhookDeliveries.eventType, "webhook.test"),
          sql`NOT EXISTS (
            SELECT 1 FROM quills.webhook_deliveries newer
            WHERE newer.webhook_id = ${webhookDeliveries.webhookId}
              AND newer.event_id = ${webhookDeliveries.eventId}
              AND (newer.status = 'succeeded' OR newer.created_at > ${webhookDeliveries.createdAt})
          )`,
        ),
      )
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(50);
    const uniqueEvents = [...new Set(failedRows.map((r) => r.eventId))];
    for (const eventId of uniqueEvents) {
      const replayId = createId("job");
      await db
        .insert(jobQueue)
        .values({
          jobId: replayId,
          queue: "quills.webhook",
          payload: { eventId, webhookId: params.webhookId, replayId },
          dedupeKey: `replay:${eventId}:${params.webhookId}:${replayId}`,
          maxAttempts: 10,
        })
        .onConflictDoNothing();
    }
    return { queuedCount: uniqueEvents.length };
  },
});

const INTERNAL_EVENT_TYPES = [
  "message.note_created",
  "message.note_updated",
  "message.note_deleted",
  "ticket.note_added",
  "portal.invite_sent",
  "user.contact_email_code_requested",
  "webhook.secret_rotated",
  "webhook.failing",
  "notification.digest_sent",
  "message.send_scheduled",
  "message.send_recalled",
  "request_link.created",
  "request_link.revoked",
] as const;

const listEvents = defineQuillsRoute({
  method: "get",
  path: "/events",
  operationId: "listQuillsEvents",
  summary: "List workspace outbox events for cursor-based replay (#330)",
  description:
    "Lets webhook consumers catch up after downtime by polling deliverable non-private events strictly after a timestamp (`since`) or numeric cursor (`afterId`).",
  action: "manage_settings",
  query: z.object({
    since: z.iso.datetime().optional(),
    afterId: z.coerce.bigint().min(0n).optional(),
    type: z.string().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  response: z.object({
    events: z.array(
      z.object({
        cursor: z.string(),
        id: z.string(),
        type: z.string(),
        entityType: z.string(),
        entityId: z.string(),
        payload: z.record(z.string(), z.unknown()),
        occurredAt: z.string(),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
  responseDescription: "Chronological page of outbox events",
  errors: { 403: errors[403] },
  handler: async ({ db, query }) => {
    const conditions = [
      sql`coalesce(${eventsTable.context}->>'deliver', 'true') = 'true'`,
      notInArray(eventsTable.type, [...INTERNAL_EVENT_TYPES]),
    ];
    if (query.since) {
      conditions.push(gte(eventsTable.occurredAt, new Date(query.since)));
    }
    if (query.afterId !== undefined) {
      conditions.push(gt(eventsTable.id, query.afterId));
    }
    if (query.type) {
      conditions.push(eq(eventsTable.type, query.type));
    }
    const rows = await db
      .select({
        id: eventsTable.id,
        eventId: eventsTable.eventId,
        type: eventsTable.type,
        entityType: eventsTable.entityType,
        entityId: eventsTable.entityId,
        payload: eventsTable.payload,
        occurredAt: eventsTable.occurredAt,
      })
      .from(eventsTable)
      .where(and(...conditions))
      .orderBy(asc(eventsTable.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    const commentIds = page
      .filter((row) => row.entityType === "comment")
      .flatMap((row) => {
        const parsed = flexibleToTypeIdSchema("comment").safeParse(
          row.entityId,
        );
        return parsed.success ? [parsed.data] : [];
      });
    const privateCommentIds = commentIds.length
      ? new Set(
          (
            await db
              .select({ id: postComments.id })
              .from(postComments)
              .where(
                and(
                  inArray(postComments.id, commentIds),
                  eq(postComments.isPrivate, true),
                ),
              )
          ).map((c) => String(c.id)),
        )
      : new Set<string>();
    const visible = page.filter(
      (row) =>
        !(row.entityType === "comment" && privateCommentIds.has(row.entityId)),
    );
    return {
      events: visible.map((row) => ({
        cursor: String(row.id),
        id: row.eventId,
        type: row.type,
        entityType: row.entityType,
        entityId: row.entityId,
        payload: (row.payload ?? {}) as Record<string, unknown>,
        occurredAt: row.occurredAt.toISOString(),
      })),
      nextCursor: hasMore && page.length > 0 ? String(page.at(-1)!.id) : null,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listWebhooks)
  .openapi(...getWebhook)
  .openapi(...createWebhook)
  .openapi(...updateWebhook)
  .openapi(...deleteWebhook)
  .openapi(...rotateSecret)
  .openapi(...listDeliveries)
  .openapi(...testWebhook)
  .openapi(...replayDelivery)
  .openapi(...replayFailed)
  .openapi(...listEvents);
