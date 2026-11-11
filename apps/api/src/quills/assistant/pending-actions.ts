import { and, desc, eq, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import {
  ASSISTANT_PENDING_ACTION_STATUSES,
  assistantPendingActions,
} from "../../database/quills/schema/assistant-pending-actions";
import { assistantToolCalls } from "../../database/quills/schema/assistant-tool-calls";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { webhookEvent } from "../framework/webhook-config";
import { findConversation } from "../support/conversation-model";
import { isWriteTool, writeTools } from "./tools";

// Actions the assistant proposed. Approval runs the tool in the approver's request: the route
// checks the approver's quills:update (and API-key scope), which is every write tool's action,
// then calls the same support domain function as the teammate's own route and records the
// same change event. A rejected, expired or decided action never runs.

const params = z.object({
  actionId: flexibleToTypeIdSchema("assistant_action"),
});
const actionSchema = z.object({
  id: z.string(),
  toolName: z.string(),
  summary: z.string(),
  status: z.enum(ASSISTANT_PENDING_ACTION_STATUSES),
  conversationId: z.string().nullable(),
  ticketId: z.string().nullable(),
  requestedById: z.string().nullable(),
  decidedById: z.string().nullable(),
  proposedAt: responseTimestamp,
  expiresAt: responseTimestamp,
  decidedAt: nullableResponseTimestamp,
  executedAt: nullableResponseTimestamp,
});
const columns = {
  id: assistantPendingActions.id,
  toolName: assistantPendingActions.toolName,
  summary: assistantPendingActions.summary,
  status: assistantPendingActions.status,
  conversationId: assistantPendingActions.conversationId,
  ticketId: assistantPendingActions.ticketId,
  requestedById: assistantPendingActions.requestedById,
  decidedById: assistantPendingActions.decidedById,
  proposedAt: assistantPendingActions.proposedAt,
  expiresAt: assistantPendingActions.expiresAt,
  decidedAt: assistantPendingActions.decidedAt,
  executedAt: assistantPendingActions.executedAt,
};
type ActionId = z.output<typeof params>["actionId"];
const notFound = () => new HTTPException(404, { message: "Action not found" });
const errors = {
  404: "Action or its conversation not found",
  409: "The action was decided, expired or cannot run",
};

/** A live proposal, locked for the decision. 409 once decided or expired. */
async function proposal(db: Database, id: ActionId) {
  const [row] = await db
    .select({ ...columns, args: assistantPendingActions.args })
    .from(assistantPendingActions)
    .where(eq(assistantPendingActions.id, id))
    .for("update");
  if (!row) throw notFound();
  if (row.status !== "proposed")
    throw new HTTPException(409, {
      message: "This action was already decided",
    });
  if (row.expiresAt <= new Date())
    throw new HTTPException(409, { message: "This action expired" });
  return row;
}

const listActions = defineQuillsRoute({
  method: "get",
  path: "/assistant/pending-actions",
  operationId: "listQuillsAssistantPendingActions",
  summary: "List the actions the assistant proposed",
  description: "Newest first. Filter by status, conversation or ticket.",
  action: "read",
  query: z.object({
    status: z.enum(ASSISTANT_PENDING_ACTION_STATUSES).optional(),
    conversationId: flexibleToTypeIdSchema("conversation").optional(),
    ticketId: flexibleToTypeIdSchema("ticket").optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  response: z.object({ items: z.array(actionSchema) }),
  responseDescription: "The actions",
  handler: async ({ db, query }) => {
    const where: (SQL | undefined)[] = [
      query.status && eq(assistantPendingActions.status, query.status),
      query.conversationId &&
        eq(assistantPendingActions.conversationId, query.conversationId),
      query.ticketId && eq(assistantPendingActions.ticketId, query.ticketId),
    ];
    return {
      items: await db
        .select(columns)
        .from(assistantPendingActions)
        .where(and(...where))
        .orderBy(desc(assistantPendingActions.proposedAt))
        .limit(query.limit),
    };
  },
});

const getAction = defineQuillsRoute({
  method: "get",
  path: "/assistant/pending-actions/{actionId}",
  operationId: "getQuillsAssistantPendingAction",
  summary: "Get one proposed action",
  action: "read",
  params,
  response: actionSchema,
  responseDescription: "The action",
  errors: { 404: "Action not found" },
  handler: async ({ db, params }) => {
    const [row] = await db
      .select(columns)
      .from(assistantPendingActions)
      .where(eq(assistantPendingActions.id, params.actionId));
    if (!row) throw notFound();
    return row;
  },
});

const changeSchema = z.object({
  type: webhookEvent,
  entityType: z.literal("conversation"),
  entityId: z.string(),
  payload: z.array(z.object({ key: z.string(), value: z.string() })),
});

const approveAction = defineQuillsRoute({
  method: "post",
  path: "/assistant/pending-actions/{actionId}/approve",
  operationId: "approveQuillsAssistantAction",
  summary: "Approve and run a proposed action",
  description:
    "Needs quills:update, the permission of every write tool. The tool runs now, in this request, through the same domain checks as the teammate's own route; its change event names the approver. A failed check (for example a missing required attribute) leaves the action proposed.",
  action: "update",
  params,
  response: z.object({ action: actionSchema, change: changeSchema.nullable() }),
  responseDescription: "The executed action and the change it made",
  errors,
  event: ({ params }, result) =>
    result.change
      ? {
          type: result.change.type,
          entityType: result.change.entityType,
          entityId: result.change.entityId,
          payload: {
            ...Object.fromEntries(
              result.change.payload.map((entry) => [entry.key, entry.value]),
            ),
            assistantActionId: params.actionId,
          },
        }
      : {
          type: "assistant_action.approved",
          entityType: "assistant_action",
          entityId: params.actionId,
        },
  handler: async ({ db, actor, params }) => {
    const row = await proposal(db, params.actionId);
    const name = row.toolName;
    if (!isWriteTool(name) || !row.conversationId)
      throw new HTTPException(409, { message: "This action cannot run" });
    const tool = writeTools[name];
    const args = tool.args.safeParse(row.args);
    if (!args.success)
      throw new HTTPException(409, { message: "This action cannot run" });
    const started = Date.now();
    const conversation = await findConversation(db, row.conversationId, true);
    const change = await tool.execute(
      db,
      actor,
      conversation,
      args.data as never,
    );
    const now = new Date();
    const [updated] = await db
      .update(assistantPendingActions)
      .set({
        status: "executed",
        decidedById: actor.principalId,
        decidedAt: now,
        executedAt: now,
        result: { changed: Boolean(change) },
      })
      .where(eq(assistantPendingActions.id, row.id))
      .returning(columns);
    await db.insert(assistantToolCalls).values({
      conversationId: row.conversationId,
      pendingActionId: row.id,
      toolName: name,
      args: row.args,
      status: "succeeded",
      resultSummary: change ? "Changed" : "No change needed",
      latencyMs: Date.now() - started,
      principalId: actor.principalId,
    });
    return {
      action: updated!,
      change: change && {
        ...change,
        payload: Object.entries(change.payload).map(([key, value]) => ({
          key,
          value,
        })),
      },
    };
  },
});

const rejectAction = defineQuillsRoute({
  method: "post",
  path: "/assistant/pending-actions/{actionId}/reject",
  operationId: "rejectQuillsAssistantAction",
  summary: "Reject a proposed action",
  description:
    "Needs quills:update, as an approval does. The action never runs.",
  action: "update",
  params,
  response: actionSchema,
  responseDescription: "The rejected action",
  errors: { 404: "Action not found", 409: "The action was decided or expired" },
  event: ({ params }) => ({
    type: "assistant_action.rejected",
    entityType: "assistant_action",
    entityId: params.actionId,
  }),
  handler: async ({ db, actor, params }) => {
    const row = await proposal(db, params.actionId);
    const [updated] = await db
      .update(assistantPendingActions)
      .set({
        status: "rejected",
        decidedById: actor.principalId,
        decidedAt: new Date(),
      })
      .where(eq(assistantPendingActions.id, row.id))
      .returning(columns);
    return updated!;
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listActions)
  .openapi(...getAction)
  .openapi(...approveAction)
  .openapi(...rejectAction);
