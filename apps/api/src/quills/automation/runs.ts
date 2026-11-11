import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import {
  workflowRunEvents,
  workflowRuns,
  workflows,
} from "../../database/quills/schema/workflows";
import { defineQuillsRoute } from "../framework/define-route";
import {
  conflict,
  findConversation,
  notFound,
} from "../support/conversation-model";
import { walk } from "./graph";
import { actionOut, findWorkflow, loadContext } from "./model";
import { workflowParams } from "./workflows";

// Runs: the manual run, the dry-run preview and the reporting reads.

const conversationId = flexibleToTypeIdSchema("conversation");

const runnable = defineQuillsRoute({
  method: "get",
  path: "/automation/runnable-workflows",
  operationId: "listQuillsRunnableWorkflows",
  summary: "List the live workflows a teammate can run on a conversation",
  description: "Needs quills:update, like the manual run itself.",
  action: "update",
  response: z.object({
    workflows: z.array(
      z.object({ id: z.string(), name: z.string(), triggerType: z.string() }),
    ),
  }),
  responseDescription: "The live workflows",
  handler: async ({ db }) => ({
    workflows: await db
      .select({
        id: workflows.id,
        name: workflows.name,
        triggerType: workflows.triggerType,
      })
      .from(workflows)
      .where(and(eq(workflows.status, "live"), isNull(workflows.deletedAt)))
      .orderBy(asc(workflows.sortOrder), asc(workflows.createdAt))
      .limit(200),
  }),
});

const run = defineQuillsRoute({
  method: "post",
  path: "/automation/workflows/{workflowId}/run",
  operationId: "runQuillsWorkflowManually",
  summary: "Run a live workflow on a conversation",
  description:
    "Queues one run, whatever the trigger. The worker runs it after commit as the teammate the workflow acts as, and that teammate's current role decides; the response does not wait for it.",
  action: "update",
  params: workflowParams,
  body: z.object({ conversationId }),
  response: z.object({ workflowId: z.string(), conversationId: z.string() }),
  responseDescription: "The queued run request",
  errors: {
    404: "Workflow or conversation not found",
    409: "The workflow is not live",
  },
  event: ({ params, body }) => ({
    type: "workflow.run_requested",
    entityType: "workflow",
    entityId: params.workflowId,
    payload: { conversationId: body.conversationId },
  }),
  handler: async ({ db, params, body }) => {
    const workflow = await findWorkflow(db, params.workflowId);
    if (workflow.status !== "live") throw conflict("The workflow is not live");
    const conversation = await findConversation(db, body.conversationId);
    return { workflowId: workflow.id, conversationId: conversation.id };
  },
});

const preview = defineQuillsRoute({
  method: "get",
  path: "/automation/workflows/{workflowId}/preview",
  operationId: "previewQuillsWorkflow",
  summary: "Preview a workflow on a conversation",
  description:
    "A dry run of the stored graph on the conversation as it is now, with no triggering message. Nothing changes.",
  action: "manage_settings",
  params: workflowParams,
  query: z.object({ conversationId }),
  response: z.object({
    status: z.enum(["completed", "halted"]),
    actions: z.array(actionOut),
  }),
  responseDescription: "The actions a run would take",
  errors: { 404: "Workflow or conversation not found" },
  handler: async ({ db, params, query }) => {
    const workflow = await findWorkflow(db, params.workflowId);
    const conversation = await findConversation(db, query.conversationId);
    return walk(workflow.graph, await loadContext(db, conversation));
  },
});

const runOut = z.object({
  id: z.string(),
  state: z.string(),
  conversationId: z.string().nullable(),
  startedAt: responseTimestamp,
  endedAt: nullableResponseTimestamp,
});

const runs = defineQuillsRoute({
  method: "get",
  path: "/automation/workflows/{workflowId}/runs",
  operationId: "listQuillsWorkflowRuns",
  summary: "List a workflow's recent runs",
  description:
    "Newest first. A run that failed or was denied is `interrupted`; its events name why.",
  action: "manage_settings",
  params: workflowParams,
  query: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  response: z.object({ runs: z.array(runOut) }),
  responseDescription: "The runs",
  errors: { 404: "Workflow not found" },
  handler: async ({ db, params, query }) => {
    const workflow = await findWorkflow(db, params.workflowId);
    return {
      runs: await db
        .select({
          id: workflowRuns.id,
          state: workflowRuns.state,
          conversationId: workflowRuns.conversationId,
          startedAt: workflowRuns.startedAt,
          endedAt: workflowRuns.endedAt,
        })
        .from(workflowRuns)
        .where(eq(workflowRuns.workflowId, workflow.id))
        .orderBy(desc(workflowRuns.startedAt), desc(workflowRuns.id))
        .limit(query.limit),
    };
  },
});

const timeline = defineQuillsRoute({
  method: "get",
  path: "/automation/runs/{runId}/events",
  operationId: "listQuillsWorkflowRunEvents",
  summary: "List a run's events",
  description:
    "Oldest first: `started`, one `action:<type>` or `unchanged:<type>` per action, then `completed`, `halted` (a later condition stopped it), `denied` or `failed`.",
  action: "manage_settings",
  params: z.object({ runId: flexibleToTypeIdSchema("workflow_run") }),
  response: z.object({
    events: z.array(z.object({ kind: z.string(), at: responseTimestamp })),
  }),
  responseDescription: "The run's events",
  errors: { 404: "Run not found" },
  handler: async ({ db, params }) => {
    const [found] = await db
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, params.runId));
    if (!found) throw notFound("Run");
    return {
      events: await db
        .select({ kind: workflowRunEvents.kind, at: workflowRunEvents.at })
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, found.id))
        .orderBy(asc(workflowRunEvents.at), asc(workflowRunEvents.id))
        .limit(200),
    };
  },
});

const effectiveness = defineQuillsRoute({
  method: "get",
  path: "/automation/effectiveness",
  operationId: "getQuillsWorkflowEffectiveness",
  summary: "Count each workflow's runs by outcome",
  description:
    "Runs started in the last `days` days (default 7), per workflow that is not deleted.",
  action: "manage_settings",
  query: z.object({
    days: z.coerce.number().int().min(1).max(90).default(7),
  }),
  response: z.object({
    workflows: z.array(
      z.object({
        workflowId: z.string(),
        started: z.number(),
        completed: z.number(),
        interrupted: z.number(),
      }),
    ),
  }),
  responseDescription: "Run counts per workflow",
  handler: async ({ db, query }) => ({
    workflows: await db
      .select({
        workflowId: workflowRuns.workflowId,
        started: sql<number>`count(*)::int`,
        completed: sql<number>`(count(*) filter (where ${workflowRuns.state} = 'done'))::int`,
        interrupted: sql<number>`(count(*) filter (where ${workflowRuns.state} = 'interrupted'))::int`,
      })
      .from(workflowRuns)
      .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
      .where(
        and(
          isNull(workflows.deletedAt),
          gte(
            workflowRuns.startedAt,
            sql`now() - make_interval(days => ${query.days})`,
          ),
        ),
      )
      .groupBy(workflowRuns.workflowId),
  }),
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...runnable)
  .openapi(...run)
  .openapi(...preview)
  .openapi(...runs)
  .openapi(...timeline)
  .openapi(...effectiveness);
