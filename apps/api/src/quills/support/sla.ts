import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { officeHoursSchedules } from "../../database/quills/schema/office-hours";
import { slaPolicies } from "../../database/quills/schema/sla";
import { workflows } from "../../database/quills/schema/workflows";
import { readSettingsKey, writeSettingsKey } from "../feedback/settings-json";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { notFound } from "./ticket-view";

type Policy = typeof slaPolicies.$inferSelect;
const TARGETS = [
  "firstResponseTargetSecs",
  "nextResponseTargetSecs",
  "timeToCloseTargetSecs",
  "timeToResolveTargetSecs",
] as const;
const errors = {
  404: "SLA policy or office-hours schedule not found",
  409: "A live workflow applies the policy, or a set target would be removed",
};
const params = z.object({ slaPolicyId: flexibleToTypeIdSchema("sla_policy") });
const target = z
  .number()
  .int()
  .positive()
  .max(365 * 86400)
  .nullable();
const workflowRef = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
});
const policySchema = z.object({
  id: z.string(),
  name: z.string(),
  firstResponseTargetSecs: z.number().nullable(),
  nextResponseTargetSecs: z.number().nullable(),
  timeToCloseTargetSecs: z.number().nullable(),
  timeToResolveTargetSecs: z.number().nullable(),
  pauseOnSnooze: z.boolean(),
  pauseOnPending: z.boolean(),
  officeHoursScheduleId: z.string().nullable(),
  archivedAt: nullableResponseTimestamp,
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
  usedByWorkflows: z.array(workflowRef),
});

/** Workflows whose graph has an apply_sla node for the policy. */
async function referencingWorkflows(db: Database) {
  const rows = await db
    .select({
      id: workflows.id,
      name: workflows.name,
      status: workflows.status,
      graph: workflows.graph,
    })
    .from(workflows)
    .where(isNull(workflows.deletedAt))
    // ponytail: scans every workflow graph in JS; index apply_sla nodes if workflows reach thousands.
    .limit(5000);
  return (policyId: string) =>
    rows
      .filter((w) => {
        const nodes = (w.graph as { nodes?: unknown } | null)?.nodes;
        return (
          Array.isArray(nodes) &&
          nodes.some((node) => {
            const action = (
              node as { action?: { type?: string; policyId?: string } } | null
            )?.action;
            return action?.type === "apply_sla" && action.policyId === policyId;
          })
        );
      })
      .map(({ id, name, status }) => ({ id, name, status }));
}

const view = (p: Policy, usedByWorkflows: z.input<typeof workflowRef>[]) => ({
  id: p.id,
  name: p.name,
  firstResponseTargetSecs: p.firstResponseTargetSecs,
  nextResponseTargetSecs: p.nextResponseTargetSecs,
  timeToCloseTargetSecs: p.timeToCloseTargetSecs,
  timeToResolveTargetSecs: p.timeToResolveTargetSecs,
  pauseOnSnooze: p.pauseOnSnooze,
  pauseOnPending: p.pauseOnPending,
  officeHoursScheduleId: p.officeHoursScheduleId,
  archivedAt: p.deletedAt,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  usedByWorkflows,
});

async function findPolicy(db: Database, id: Policy["id"], archived = false) {
  const [row] = await db
    .select()
    .from(slaPolicies)
    .where(
      and(
        eq(slaPolicies.id, id),
        archived
          ? isNotNull(slaPolicies.deletedAt)
          : isNull(slaPolicies.deletedAt),
      ),
    )
    .for("update");
  if (!row) throw notFound("SLA policy");
  return row;
}

async function checkSchedule(
  db: Database,
  id: Policy["officeHoursScheduleId"] | undefined,
) {
  if (!id) return;
  const [row] = await db
    .select({ id: officeHoursSchedules.id })
    .from(officeHoursSchedules)
    .where(eq(officeHoursSchedules.id, id));
  if (!row) throw notFound("Office-hours schedule");
}

const listPolicies = defineQuillsRoute({
  method: "get",
  path: "/sla-policies",
  operationId: "listQuillsSlaPolicies",
  summary: "List SLA policies, archived included",
  action: "manage_settings",
  response: z.object({ items: z.array(policySchema) }),
  responseDescription: "The SLA policies",
  handler: async ({ db }) => {
    const rows = await db
      .select()
      .from(slaPolicies)
      .orderBy(desc(slaPolicies.createdAt))
      .limit(500);
    const using = await referencingWorkflows(db);
    return { items: rows.map((p) => view(p, using(p.id))) };
  },
});

const duration = (secs: number) =>
  secs % 86400 === 0
    ? `${secs / 86400}d`
    : secs % 3600 === 0
      ? `${secs / 3600}h`
      : secs % 60 === 0
        ? `${secs / 60}m`
        : `${secs}s`;
const summary = (p: Policy) => {
  const parts = (
    [
      ["first response", p.firstResponseTargetSecs],
      ["next response", p.nextResponseTargetSecs],
      ["close", p.timeToCloseTargetSecs],
      ["resolve", p.timeToResolveTargetSecs],
    ] as const
  ).flatMap(([label, secs]) => (secs ? [`${label} ${duration(secs)}`] : []));
  const text = parts.join(" · ") || "no targets";
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const listOptions = defineQuillsRoute({
  method: "get",
  path: "/sla-policies/options",
  operationId: "listQuillsSlaPolicyOptions",
  summary: "List live SLA policies for a picker",
  action: "read",
  response: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        targetsSummary: z.string(),
        hasTimeToResolveTarget: z.boolean(),
      }),
    ),
  }),
  responseDescription: "The live SLA policies",
  handler: async ({ db }) => ({
    items: (
      await db
        .select()
        .from(slaPolicies)
        .where(isNull(slaPolicies.deletedAt))
        .orderBy(desc(slaPolicies.createdAt))
        .limit(500)
    ).map((p) => ({
      id: p.id,
      name: p.name,
      targetsSummary: summary(p),
      hasTimeToResolveTarget: p.timeToResolveTargetSecs != null,
    })),
  }),
});

const getOfficeHours = defineQuillsRoute({
  method: "get",
  path: "/sla-policies/office-hours",
  operationId: "getQuillsSlaOfficeHours",
  summary: "Whether the workspace office-hours schedule is on",
  description: "SLA clocks count only open hours when it is on.",
  action: "manage_settings",
  response: z.object({ officeHoursEnabled: z.boolean() }),
  responseDescription: "The office-hours state",
  handler: async ({ db }) => {
    const stored = await readSettingsKey(db, "metadata", "officeHours");
    return {
      officeHoursEnabled:
        !!stored &&
        typeof stored === "object" &&
        (stored as { enabled?: unknown }).enabled === true,
    };
  },
});

const fields = {
  name: z.string().trim().min(1).max(120),
  firstResponseTargetSecs: target.optional(),
  nextResponseTargetSecs: target.optional(),
  timeToCloseTargetSecs: target.optional(),
  timeToResolveTargetSecs: target.optional(),
  pauseOnSnooze: z.boolean().optional(),
  pauseOnPending: z.boolean().optional(),
  officeHoursScheduleId: flexibleToTypeIdSchema("office_hours")
    .nullable()
    .optional(),
};

const createPolicy = defineQuillsRoute({
  method: "post",
  path: "/sla-policies",
  operationId: "createQuillsSlaPolicy",
  summary: "Create an SLA policy",
  action: "manage_settings",
  body: z
    .object(fields)
    .refine(
      (b) => TARGETS.some((key) => b[key] != null),
      "Set at least one target",
    ),
  response: policySchema,
  responseDescription: "The new SLA policy",
  errors,
  event: (_input, policy) => ({
    type: "sla_policy.created",
    entityType: "sla_policy",
    entityId: policy.id,
  }),
  handler: async ({ db, body }) => {
    await checkSchedule(db, body.officeHoursScheduleId);
    const [row] = await db
      .insert(slaPolicies)
      .values({
        name: body.name,
        firstResponseTargetSecs: body.firstResponseTargetSecs ?? null,
        nextResponseTargetSecs: body.nextResponseTargetSecs ?? null,
        timeToCloseTargetSecs: body.timeToCloseTargetSecs ?? null,
        timeToResolveTargetSecs: body.timeToResolveTargetSecs ?? null,
        pauseOnSnooze: body.pauseOnSnooze ?? true,
        pauseOnPending: body.pauseOnPending ?? true,
        officeHoursScheduleId: body.officeHoursScheduleId ?? null,
      })
      .returning();
    return view(row!, []);
  },
});

const updatePolicy = defineQuillsRoute({
  method: "patch",
  path: "/sla-policies/{slaPolicyId}",
  operationId: "updateQuillsSlaPolicy",
  summary: "Update an SLA policy",
  description:
    "Targets can be added or changed, never removed once set. Changes apply to conversations and tickets that get the policy later.",
  action: "manage_settings",
  params,
  body: z
    .object({ ...fields, name: fields.name.optional() })
    .refine(
      (b) => Object.values(b).some((v) => v !== undefined),
      "Send at least one field",
    ),
  response: policySchema,
  responseDescription: "The SLA policy",
  errors,
  event: ({ params }) => ({
    type: "sla_policy.updated",
    entityType: "sla_policy",
    entityId: params.slaPolicyId,
  }),
  handler: async ({ db, params, body }) => {
    const existing = await findPolicy(db, params.slaPolicyId);
    if (TARGETS.some((key) => existing[key] != null && body[key] === null))
      throw new HTTPException(409, {
        message: "Targets can be changed but not removed once set",
      });
    await checkSchedule(db, body.officeHoursScheduleId);
    const [row] = await db
      .update(slaPolicies)
      .set({
        name: body.name,
        firstResponseTargetSecs: body.firstResponseTargetSecs,
        nextResponseTargetSecs: body.nextResponseTargetSecs,
        timeToCloseTargetSecs: body.timeToCloseTargetSecs,
        timeToResolveTargetSecs: body.timeToResolveTargetSecs,
        pauseOnSnooze: body.pauseOnSnooze,
        pauseOnPending: body.pauseOnPending,
        officeHoursScheduleId: body.officeHoursScheduleId,
        updatedAt: new Date(),
      })
      .where(eq(slaPolicies.id, existing.id))
      .returning();
    return view(row!, (await referencingWorkflows(db))(existing.id));
  },
});

const archivePolicy = defineQuillsRoute({
  method: "post",
  path: "/sla-policies/{slaPolicyId}/archive",
  operationId: "archiveQuillsSlaPolicy",
  summary: "Archive an SLA policy",
  description:
    "Refused (409) while a live workflow applies it. Conversations and tickets that have it keep it.",
  action: "manage_settings",
  params,
  response: policySchema,
  responseDescription: "The archived SLA policy",
  errors,
  event: ({ params }) => ({
    type: "sla_policy.archived",
    entityType: "sla_policy",
    entityId: params.slaPolicyId,
  }),
  handler: async ({ db, params }) => {
    const existing = await findPolicy(db, params.slaPolicyId);
    const using = (await referencingWorkflows(db))(existing.id);
    const live = using.filter((w) => w.status === "live");
    if (live.length)
      throw new HTTPException(409, {
        message:
          `Live workflows apply this policy: ${live.map((w) => w.name).join(", ")}`.slice(
            0,
            500,
          ),
      });
    const now = new Date();
    const [row] = await db
      .update(slaPolicies)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(slaPolicies.id, existing.id))
      .returning();
    return view(row!, using);
  },
});

const restorePolicy = defineQuillsRoute({
  method: "post",
  path: "/sla-policies/{slaPolicyId}/restore",
  operationId: "restoreQuillsSlaPolicy",
  summary: "Restore an archived SLA policy",
  action: "manage_settings",
  params,
  response: policySchema,
  responseDescription: "The restored SLA policy",
  errors,
  event: ({ params }) => ({
    type: "sla_policy.restored",
    entityType: "sla_policy",
    entityId: params.slaPolicyId,
  }),
  handler: async ({ db, params }) => {
    const existing = await findPolicy(db, params.slaPolicyId, true);
    const [row] = await db
      .update(slaPolicies)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(slaPolicies.id, existing.id))
      .returning();
    return view(row!, (await referencingWorkflows(db))(existing.id));
  },
});

const DEFAULT_KEY = "defaultSlaPolicy";
const defaultSchema = z.object({ policyId: z.string().nullable() });

const getDefault = defineQuillsRoute({
  method: "get",
  path: "/support/default-sla-policy",
  operationId: "getQuillsDefaultSlaPolicy",
  summary: "Get the default SLA policy",
  description:
    "New conversations get this policy when no workflow applies one. Null: none.",
  action: "manage_settings",
  response: defaultSchema,
  responseDescription: "The default SLA policy",
  handler: async ({ db }) => {
    const stored = await readSettingsKey(db, "metadata", DEFAULT_KEY);
    const id = (stored as { policyId?: unknown } | undefined)?.policyId;
    return { policyId: typeof id === "string" ? id : null };
  },
});

const setDefault = defineQuillsRoute({
  method: "put",
  path: "/support/default-sla-policy",
  operationId: "setQuillsDefaultSlaPolicy",
  summary: "Set the default SLA policy",
  description: "The policy must be live. Null clears the default.",
  action: "manage_settings",
  body: z.object({ policyId: flexibleToTypeIdSchema("sla_policy").nullable() }),
  response: defaultSchema,
  responseDescription: "The default SLA policy",
  errors,
  event: ({ workspaceId }) => ({
    type: "settings.default_sla_policy_updated",
    entityType: "settings",
    entityId: workspaceId,
  }),
  handler: async ({ db, body }) => {
    if (body.policyId) await findPolicy(db, body.policyId);
    return writeSettingsKey(db, "metadata", DEFAULT_KEY, () => ({
      policyId: body.policyId,
    }));
  },
});

/** Teammate routes for SLA policies and the default policy. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listPolicies)
  .openapi(...listOptions)
  .openapi(...getOfficeHours)
  .openapi(...createPolicy)
  .openapi(...updatePolicy)
  .openapi(...archivePolicy)
  .openapi(...restorePolicy)
  .openapi(...getDefault)
  .openapi(...setDefault);
