// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { responseTimestamp, z } from "../../openapi";
import {
  conversationMessages,
  conversationTagAssignments,
} from "../../database/quills/schema/conversation";
import {
  workflowVersions,
  workflows,
  type Workflow,
} from "../../database/quills/schema/workflows";
import type { Database } from "../framework/define-route";
import type { ConditionContext } from "./graph";
import {
  currentTeammates,
  notFound,
  priorities,
  type Conversation,
} from "../support/conversation-model";
import { resolveLiveTag, resolveTeam } from "../support/conversation-ops";

// The workflow graph: its input and response shapes, the condition evaluator and the walker.
// The walker is pure; the engine (engine.ts) runs the actions it returns.

/** Outbox events that start a live workflow. Each names one conversation: its entity or `payload.conversationId`. */
export const TRIGGERS = [
  "conversation.status_changed",
  "conversation.assigned",
  "conversation.priority_changed",
  "conversation.attribute_changed",
  "conversation.tags_changed",
  "message.created",
  "message.note_created",
] as const;

export const FIELDS = [
  "conversation.status",
  "conversation.channel",
  "conversation.priority",
  "conversation.tags",
  "conversation.team",
  "message.body",
  "message.sender",
] as const;
/** `conversation.attr.<key>` reads a custom attribute of the conversation. */
export const ATTRIBUTE = "conversation.attr.";
const OPS = [
  "eq",
  "neq",
  "contains",
  "not_contains",
  "contains_any",
  "contains_all",
  "gt",
  "gte",
  "lt",
  "lte",
  "includes_any",
  "excludes_all",
  "is_set",
  "is_empty",
] as const;

/** Operators that take a list in `values`; the others take one `value`. */
export const LIST_OPS: ReadonlySet<string> = new Set([
  "contains_any",
  "contains_all",
  "includes_any",
  "excludes_all",
]);
const scalar = z.union([
  z.string().max(500),
  z.number(),
  z.boolean(),
  z.null(),
]);
const leaf = z
  .object({
    field: z.union([
      z.enum(FIELDS),
      z
        .string()
        .max(200)
        .refine(
          (f) => f.startsWith(ATTRIBUTE) && f.length > ATTRIBUTE.length,
          "Unknown condition field",
        ),
    ]),
    op: z.enum(OPS),
    value: scalar.optional(),
    /** A list value, for the keyword and set operators. */
    values: z.array(z.string().max(200)).max(50).optional(),
  })
  .strict()
  .refine(
    (l) =>
      LIST_OPS.has(l.op) ? l.value === undefined : l.values === undefined,
    "Use `values` with a list operator and `value` with the others",
  );
const groupOf = <T extends z.ZodType>(child: T) =>
  z
    .object({
      all: z.array(child).max(10).optional(),
      any: z.array(child).max(10).optional(),
    })
    .strict();
/** A leaf, or a group two levels deep: the depth is bounded by the schema itself. */
export const conditionInput = z.union([
  leaf,
  groupOf(z.union([leaf, groupOf(leaf)])),
]);

const id = z.string().min(1).max(64);
export const actionInput = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("assign_agent"),
      principalId: flexibleToTypeIdSchema("principal"),
    })
    .strict(),
  z
    .object({
      type: z.literal("assign_team"),
      teamId: flexibleToTypeIdSchema("team"),
    })
    .strict(),
  z
    .object({
      type: z.literal("add_tag"),
      tagId: flexibleToTypeIdSchema("conversation_tag"),
    })
    .strict(),
  z
    .object({ type: z.literal("set_priority"), priority: z.enum(priorities) })
    .strict(),
  z
    .object({
      type: z.literal("snooze"),
      seconds: z
        .number()
        .int()
        .min(60)
        .max(90 * 24 * 3600),
    })
    .strict(),
  z.object({ type: z.literal("close") }).strict(),
  z.object({ type: z.literal("reopen") }).strict(),
]);
export type WorkflowAction = z.output<typeof actionInput>;

const node = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("trigger") }).strict(),
  z.object({ id, type: z.literal("action"), action: actionInput }).strict(),
  z
    .object({ id, type: z.literal("condition"), condition: conditionInput })
    .strict(),
  z
    .object({
      id,
      type: z.literal("branch"),
      branches: z
        .array(z.object({ key: id, condition: conditionInput }).strict())
        .min(1)
        .max(10),
    })
    .strict(),
]);
const edge = z.object({ from: id, to: id, branch: id.optional() }).strict();

/** Rejects what the walker can never use: duplicate step IDs, edges to missing steps, undeclared branch keys. */
export const graphInput = z
  .object({ nodes: z.array(node).max(100), edges: z.array(edge).max(200) })
  .strict()
  .superRefine((graph, ctx) => {
    if (JSON.stringify(graph).length > 65536)
      ctx.addIssue({ code: "custom", message: "The graph exceeds 64 KiB" });
    const ids = new Set<string>();
    for (const n of graph.nodes) {
      if (ids.has(n.id))
        ctx.addIssue({ code: "custom", message: `Duplicate step "${n.id}"` });
      ids.add(n.id);
    }
    const keys = new Map(
      graph.nodes.flatMap((n) =>
        n.type === "branch"
          ? [[n.id, new Set(n.branches.map((b) => b.key))] as const]
          : [],
      ),
    );
    for (const e of graph.edges) {
      for (const end of [e.from, e.to])
        if (!ids.has(end))
          ctx.addIssue({ code: "custom", message: `Missing step "${end}"` });
      if (e.branch !== undefined && !keys.get(e.from)?.has(e.branch))
        ctx.addIssue({
          code: "custom",
          message: `Step "${e.from}" has no path "${e.branch}"`,
        });
    }
  });
export type WorkflowGraph = z.output<typeof graphInput>;

// Responses are closed objects: every node kind shares one shape with optional parts.
const scalarOut = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const leafShape = {
  field: z.string().optional(),
  op: z.string().optional(),
  value: scalarOut.optional(),
  values: z.array(z.string()).optional(),
};
const leafOut = z.object(leafShape);
const innerOut = z.object({
  ...leafShape,
  all: z.array(leafOut).optional(),
  any: z.array(leafOut).optional(),
});
const conditionOut = z.object({
  ...leafShape,
  all: z.array(innerOut).optional(),
  any: z.array(innerOut).optional(),
});
export const actionOut = z.object({
  type: z.string(),
  principalId: z.string().optional(),
  teamId: z.string().optional(),
  tagId: z.string().optional(),
  priority: z.string().optional(),
  seconds: z.number().optional(),
});
export const graphOut = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      action: actionOut.optional(),
      condition: conditionOut.optional(),
      branches: z
        .array(z.object({ key: z.string(), condition: conditionOut }))
        .optional(),
    }),
  ),
  edges: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      branch: z.string().optional(),
    }),
  ),
});
export const workflowOut = z.object({
  id: z.string(),
  name: z.string(),
  class: z.string(),
  status: z.enum(["draft", "live", "paused"]),
  sortOrder: z.number(),
  triggerType: z.string(),
  graph: graphOut,
  /** The teammate a live workflow acts as: the author of its newest version. */
  actorPrincipalId: z.string().nullable(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});

/** A stored graph as the response shape. An imported graph that does not fit reads as empty. */
export function viewGraph(raw: unknown): z.output<typeof graphOut> {
  const parsed = graphOut.safeParse(raw);
  return parsed.success ? parsed.data : { nodes: [], edges: [] };
}

export const view = (row: Workflow, actorPrincipalId: string | null) => ({
  id: row.id,
  name: row.name,
  class: row.class,
  status: row.status,
  sortOrder: row.sortOrder,
  triggerType: row.triggerType,
  graph: viewGraph(row.graph),
  actorPrincipalId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export async function findWorkflow(
  db: Database,
  workflowId: Workflow["id"],
  lock = false,
) {
  const query = db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), isNull(workflows.deletedAt)));
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw notFound("Workflow");
  return row;
}

/**
 * The teammate each workflow acts as: the author of its newest version. Publishing, and every
 * change to what it does, writes a version under the workflow row lock, so the newest author
 * is the teammate who last put its current logic into effect. Null: nobody (deleted).
 */
export async function actorsOf(db: Database, ids: Workflow["id"][]) {
  if (!ids.length) return new Map<string, Workflow["createdBy"]>();
  const rows = await db
    .selectDistinctOn([workflowVersions.workflowId], {
      workflowId: workflowVersions.workflowId,
      createdBy: workflowVersions.createdBy,
    })
    .from(workflowVersions)
    .where(inArray(workflowVersions.workflowId, ids))
    .orderBy(
      workflowVersions.workflowId,
      desc(workflowVersions.createdAt),
      desc(workflowVersions.id),
    );
  return new Map<string, Workflow["createdBy"]>(
    rows.map((row) => [row.workflowId, row.createdBy]),
  );
}

export const actingPrincipal = async (db: Database, id: Workflow["id"]) =>
  (await actorsOf(db, [id])).get(id) ?? null;

const KEPT_VERSIONS = 50;

/** Snapshots the workflow as `createdBy` saved it and keeps the newest 50 versions. Call it under the row lock. */
export async function writeVersion(
  db: Database,
  row: Workflow,
  createdBy: NonNullable<Workflow["createdBy"]>,
) {
  await db.insert(workflowVersions).values({
    workflowId: row.id,
    name: row.name,
    triggerType: row.triggerType,
    triggerSettings: row.triggerSettings,
    graph: row.graph,
    createdBy,
    // After the row lock, so version order is save order, not transaction-start order.
    createdAt: sql`clock_timestamp()`,
  });
  const kept = db
    .select({ id: workflowVersions.id })
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, row.id))
    .orderBy(desc(workflowVersions.createdAt), desc(workflowVersions.id))
    .limit(KEPT_VERSIONS);
  await db
    .delete(workflowVersions)
    .where(
      and(
        eq(workflowVersions.workflowId, row.id),
        notInArray(workflowVersions.id, kept),
      ),
    );
}

/** Every teammate, team and tag that an action names must exist in this workspace now. */
export async function checkReferences(
  db: Database,
  members: readonly string[],
  graph: WorkflowGraph,
) {
  for (const n of graph.nodes) {
    if (n.type !== "action") continue;
    const action = n.action;
    if (action.type === "assign_agent") {
      const [teammate] = await currentTeammates(db, members, [
        action.principalId,
      ]);
      if (!teammate) throw notFound("Teammate");
    }
    if (action.type === "assign_team") await resolveTeam(db, action.teamId);
    if (action.type === "add_tag") await resolveLiveTag(db, action.tagId);
  }
}

/** The snapshot conditions read: the conversation now, and the message the event names. */
export async function loadContext(
  db: Database,
  conversation: Conversation,
  messageId?: TypeId<"conversation_msg">,
): Promise<ConditionContext> {
  const tags = await db
    .select({ id: conversationTagAssignments.conversationTagId })
    .from(conversationTagAssignments)
    .where(eq(conversationTagAssignments.conversationId, conversation.id));
  const [message] = messageId
    ? await db
        .select({
          body: conversationMessages.content,
          sender: conversationMessages.senderType,
        })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.id, messageId),
            eq(conversationMessages.conversationId, conversation.id),
            isNull(conversationMessages.deletedAt),
          ),
        )
    : [];
  return {
    conversation: {
      status: conversation.status,
      channel: conversation.channel,
      priority: conversation.priority,
      tagIds: tags.map((tag) => tag.id),
      teamId: conversation.assignedTeamId,
      attributes: conversation.customAttributes ?? {},
    },
    message: message ?? null,
  };
}
