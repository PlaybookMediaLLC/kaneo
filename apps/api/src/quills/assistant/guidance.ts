import { asc, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { assistantGuidanceRules } from "../../database/quills/schema/assistant-guidance";
import { checkOrder, positionCase } from "../feedback/id-sets";
import { someField } from "../feedback/schemas";
import { defineQuillsRoute, type Database } from "../framework/define-route";

// Guidance rules steer how one agent answers: the customer agent or the copilot.

const AGENTS = ["agent", "copilot"] as const;
const MAX_RULES = 100;
const params = z.object({
  ruleId: flexibleToTypeIdSchema("assistant_guidance"),
});
const notFound = () =>
  new HTTPException(404, { message: "Guidance rule not found" });
const ruleSchema = z.object({
  id: z.string(),
  name: z.string(),
  appliesWhen: z.string().nullable(),
  instruction: z.string(),
  agent: z.enum(AGENTS),
  enabled: z.boolean(),
  priority: z.number(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
});
const columns = {
  id: assistantGuidanceRules.id,
  name: assistantGuidanceRules.name,
  appliesWhen: assistantGuidanceRules.appliesWhen,
  instruction: assistantGuidanceRules.instruction,
  agent: assistantGuidanceRules.agent,
  enabled: assistantGuidanceRules.enabled,
  priority: assistantGuidanceRules.priority,
  createdAt: assistantGuidanceRules.createdAt,
  updatedAt: assistantGuidanceRules.updatedAt,
};
const fields = {
  name: z.string().trim().min(1).max(80),
  appliesWhen: z.string().trim().min(1).max(500).nullable(),
  instruction: z.string().trim().min(1).max(1000),
  agent: z.enum(AGENTS),
  enabled: z.boolean(),
};
const errors = { 404: "Guidance rule not found" };
type RuleId = z.output<typeof params>["ruleId"];
const view = (row: typeof assistantGuidanceRules.$inferSelect) => ({
  ...row,
  agent: row.agent as (typeof AGENTS)[number],
});

const listRules = defineQuillsRoute({
  method: "get",
  path: "/assistant/guidance-rules",
  operationId: "listQuillsGuidanceRules",
  summary: "List the assistant guidance rules",
  description: "In run order: lower priority first.",
  action: "manage_settings",
  query: z.object({ agent: z.enum(AGENTS).optional() }),
  response: z.object({ items: z.array(ruleSchema) }),
  responseDescription: "The guidance rules",
  handler: async ({ db, query }) => ({
    items: (
      await db
        .select(columns)
        .from(assistantGuidanceRules)
        .where(query.agent && eq(assistantGuidanceRules.agent, query.agent))
        .orderBy(asc(assistantGuidanceRules.priority), asc(columns.createdAt))
        .limit(MAX_RULES)
    ).map((row) => view(row as never)),
  }),
});

const createRule = defineQuillsRoute({
  method: "post",
  path: "/assistant/guidance-rules",
  operationId: "createQuillsGuidanceRule",
  summary: "Create an assistant guidance rule",
  description: `A new rule runs last. A workspace has at most ${MAX_RULES} rules.`,
  action: "manage_settings",
  body: z.object({
    ...fields,
    appliesWhen: fields.appliesWhen.default(null),
    enabled: fields.enabled.default(true),
  }),
  response: ruleSchema,
  responseDescription: "The new rule",
  errors: { 409: `A workspace has at most ${MAX_RULES} rules` },
  event: (_input, rule) => ({
    type: "assistant_guidance.created",
    entityType: "assistant_guidance",
    entityId: rule.id,
  }),
  handler: async ({ db, actor, body }) => {
    const [stats] = await db
      .select({
        n: sql<number>`count(*)::int`,
        last: sql<number>`coalesce(max(${assistantGuidanceRules.priority}), -1)::int`,
      })
      .from(assistantGuidanceRules);
    if (stats!.n >= MAX_RULES)
      throw new HTTPException(409, {
        message: `A workspace has at most ${MAX_RULES} rules`,
      });
    const [row] = await db
      .insert(assistantGuidanceRules)
      .values({
        name: body.name,
        appliesWhen: body.appliesWhen,
        instruction: body.instruction,
        agent: body.agent,
        enabled: body.enabled,
        priority: stats!.last + 1,
        createdById: actor.principalId,
      })
      .returning(columns);
    return view(row as never);
  },
});

async function findRule(db: Database, id: RuleId) {
  const [row] = await db
    .select(columns)
    .from(assistantGuidanceRules)
    .where(eq(assistantGuidanceRules.id, id))
    .for("update");
  if (!row) throw notFound();
  return row;
}

const updateRule = defineQuillsRoute({
  method: "patch",
  path: "/assistant/guidance-rules/{ruleId}",
  operationId: "updateQuillsGuidanceRule",
  summary: "Update an assistant guidance rule",
  action: "manage_settings",
  params,
  body: z
    .object({
      name: fields.name.optional(),
      appliesWhen: fields.appliesWhen.optional(),
      instruction: fields.instruction.optional(),
      agent: fields.agent.optional(),
      enabled: fields.enabled.optional(),
    })
    .refine(someField, {
      message: "Change at least one field",
    }),
  response: ruleSchema,
  responseDescription: "The updated rule",
  errors,
  event: ({ params }) => ({
    type: "assistant_guidance.updated",
    entityType: "assistant_guidance",
    entityId: params.ruleId,
  }),
  handler: async ({ db, params, body }) => {
    await findRule(db, params.ruleId);
    const [row] = await db
      .update(assistantGuidanceRules)
      .set({
        name: body.name,
        appliesWhen: body.appliesWhen,
        instruction: body.instruction,
        agent: body.agent,
        enabled: body.enabled,
        updatedAt: new Date(),
      })
      .where(eq(assistantGuidanceRules.id, params.ruleId))
      .returning(columns);
    return view(row as never);
  },
});

const deleteRule = defineQuillsRoute({
  method: "delete",
  path: "/assistant/guidance-rules/{ruleId}",
  operationId: "deleteQuillsGuidanceRule",
  summary: "Delete an assistant guidance rule",
  action: "manage_settings",
  params,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted rule's ID",
  errors,
  event: ({ params }) => ({
    type: "assistant_guidance.deleted",
    entityType: "assistant_guidance",
    entityId: params.ruleId,
  }),
  handler: async ({ db, params }) => {
    await findRule(db, params.ruleId);
    await db
      .delete(assistantGuidanceRules)
      .where(eq(assistantGuidanceRules.id, params.ruleId));
    return { id: params.ruleId };
  },
});

const reorderRules = defineQuillsRoute({
  method: "put",
  path: "/assistant/guidance-rules/order",
  operationId: "reorderQuillsGuidanceRules",
  summary: "Reorder the assistant guidance rules",
  description:
    "Send every rule's ID once, in run order. A missing, foreign or repeated ID returns 404 or 400 and changes nothing.",
  action: "manage_settings",
  body: z.object({
    ruleIds: z
      .array(flexibleToTypeIdSchema("assistant_guidance"))
      .min(1)
      .max(MAX_RULES)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Each ID can appear only once",
      }),
  }),
  response: z.object({ items: z.array(ruleSchema) }),
  responseDescription: "The rules in their new order",
  errors: { 404: "Guidance rule not found", 409: "The list is not complete" },
  event: () => ({
    type: "assistant_guidance.reordered",
    entityType: "assistant_guidance",
    entityId: "order",
  }),
  handler: async ({ db, body }) => {
    const all = await db
      .select({ id: assistantGuidanceRules.id })
      .from(assistantGuidanceRules)
      .for("update");
    checkOrder(
      body.ruleIds,
      all.map((row) => row.id),
    );
    await db
      .update(assistantGuidanceRules)
      .set({ priority: positionCase(assistantGuidanceRules.id, body.ruleIds) })
      .where(inArray(assistantGuidanceRules.id, body.ruleIds));
    return {
      items: (
        await db
          .select(columns)
          .from(assistantGuidanceRules)
          .where(inArray(assistantGuidanceRules.id, body.ruleIds))
          .orderBy(asc(assistantGuidanceRules.priority))
      ).map((row) => view(row as never)),
    };
  },
});

const ruleStats = defineQuillsRoute({
  method: "get",
  path: "/assistant/guidance-rules/stats",
  operationId: "getQuillsGuidanceRuleStats",
  summary: "Get how often each guidance rule was applied",
  description:
    "Counts the assistant answers of the last 90 days whose prompt carried the rule, from the AI usage log.",
  action: "manage_settings",
  response: z.object({
    items: z.array(
      z.object({
        ruleId: z.string(),
        appliedCount: z.number(),
        lastAppliedAt: nullableResponseTimestamp,
      }),
    ),
  }),
  responseDescription: "One entry per existing rule",
  handler: async ({ db }) => {
    const { rows } = await db.execute<{
      id: string;
      n: number;
      last: string;
    }>(
      sql`SELECT rule.value AS id, count(DISTINCT coalesce(u.metadata->>'runId', u.id::text))::int AS n, max(u.created_at)::text AS last
        FROM quills.ai_usage_log u, jsonb_array_elements_text(u.metadata->'guidanceRuleIds') AS rule
        WHERE u.metadata ? 'guidanceRuleIds' AND u.created_at > now() - interval '90 days'
        GROUP BY rule.value`,
    );
    const applied = new Map(rows.map((row) => [row.id, row]));
    const rules = await db
      .select({ id: assistantGuidanceRules.id })
      .from(assistantGuidanceRules)
      .orderBy(asc(assistantGuidanceRules.priority))
      .limit(MAX_RULES);
    return {
      items: rules.map((rule) => {
        const row = applied.get(rule.id);
        return {
          ruleId: rule.id,
          appliedCount: row?.n ?? 0,
          lastAppliedAt: row ? new Date(row.last) : null,
        };
      }),
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listRules)
  .openapi(...ruleStats)
  .openapi(...reorderRules)
  .openapi(...createRule)
  .openapi(...updateRule)
  .openapi(...deleteRule);
