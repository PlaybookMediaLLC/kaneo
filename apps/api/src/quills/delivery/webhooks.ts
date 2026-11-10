import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { BoardId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import { webhooks } from "../../database/quills/schema/webhooks";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import {
  newSigningSecret,
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

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listWebhooks)
  .openapi(...getWebhook)
  .openapi(...createWebhook)
  .openapi(...updateWebhook)
  .openapi(...deleteWebhook)
  .openapi(...rotateSecret);
