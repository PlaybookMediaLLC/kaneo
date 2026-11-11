import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { TypeId } from "@kaneo/ids";
import type { z } from "zod";
import {
  withQuillsSystemWorkspace,
  withQuillsWorkspace,
  type Database,
  type QuillsActor,
} from "../../database/quills/client";
import { principal } from "../../database/quills/schema/auth";
import { conversations } from "../../database/quills/schema/conversation";
import type { EventRow } from "../../database/quills/schema/events";
import { hookDeliveries } from "../../database/quills/schema/hook-deliveries";
import {
  workflowRunEvents,
  workflowRuns,
  workflows,
} from "../../database/quills/schema/workflows";
import { recordQuillsChange, type changeSchema } from "../events";
import { memberUserIds, teammateMayAct } from "../framework/platform-reads";
import { enqueueQuillsJob } from "../jobs/queue";
import { findConversation } from "../support/conversation-model";
import {
  assignAgent,
  assignTeam,
  attachTag,
  requireClosable,
  resolveAssignee,
  resolveLiveTag,
  resolveTeam,
  setPriority,
  setStatus,
  snooze,
} from "../support/conversation-ops";
import {
  actingPrincipal,
  loadContext,
  TRIGGERS,
  type WorkflowAction,
} from "./model";
import { walk } from "./graph";

/**
 * Workflow engine. Actor model: a run acts as the teammate who authored the workflow's newest
 * version (who published it, or last changed it while live). Before each run that teammate's
 * CURRENT Kaneo role must grant quills:update, the action every workflow action needs on its
 * route; a removed, banned or downgraded teammate makes the run fail as denied. The actions then
 * run in that teammate's own scoped transaction (withQuillsWorkspace re-checks the membership)
 * through the conversation domain code the routes use. Nothing runs through a system scope.
 */

type Event = Pick<
  EventRow,
  "eventId" | "type" | "entityType" | "entityId" | "payload"
>;
type Change = {
  type: z.input<typeof changeSchema>["type"];
  payload: Record<string, string>;
};
export type RunOutcome =
  | "skipped"
  | "duplicate"
  | "no_actions"
  | "completed"
  | "denied"
  | "failed";

const payloadOf = (event: Pick<Event, "payload">) =>
  event.payload as Record<string, string | undefined>;
/** Whether a stored graph can assign a teammate, so the run needs the member roster. */
const assigns = (graph: unknown) =>
  JSON.stringify(graph).includes('"assign_agent"');

/**
 * Queues the runs an event starts, in run order: every live workflow on its trigger, or the one
 * workflow a teammate asked to run. Call it inside the fan-out transaction; deduplication keys
 * make a repeat queue nothing. No run starts from a change that an action made (it carries its
 * run ID) or that a sweep made (no actor): neither can start a loop.
 */
export async function enqueueWorkflowRuns(
  db: Database,
  event: Event & Pick<EventRow, "actorType">,
) {
  if (payloadOf(event).workflowRunId || event.actorType === "system") return;
  const ids =
    event.type === "workflow.run_requested"
      ? [event.entityId]
      : (TRIGGERS as readonly string[]).includes(event.type)
        ? (
            await db
              .select({ id: workflows.id })
              .from(workflows)
              .where(
                and(
                  eq(workflows.triggerType, event.type),
                  eq(workflows.status, "live"),
                  isNull(workflows.deletedAt),
                ),
              )
              .orderBy(asc(workflows.sortOrder), asc(workflows.createdAt))
              // ponytail: 100 workflows per trigger; raise it if a workspace builds more.
              .limit(100)
          ).map((row) => row.id)
        : [];
  for (const workflowId of ids)
    await enqueueQuillsJob(
      db,
      "quills.workflow",
      { eventId: event.eventId, workflowId },
      `${event.eventId}:${workflowId}`,
      3,
    );
}

/** The conversation an event names, and the message when it is about one. */
function subjectOf(event: Event) {
  const conversationId = (
    event.entityType === "conversation"
      ? event.entityId
      : payloadOf(event).conversationId
  ) as TypeId<"conversation"> | undefined;
  const messageId =
    event.entityType === "conversation_message"
      ? (event.entityId as TypeId<"conversation_msg">)
      : undefined;
  return { conversationId, messageId };
}

/** Applies one action through the route's domain code. Returns the change to record, or false. */
async function apply(
  db: Database,
  actor: QuillsActor,
  members: readonly string[],
  conversationId: TypeId<"conversation">,
  action: WorkflowAction,
): Promise<Change | false> {
  const conversation = await findConversation(db, conversationId, true);
  const status = (value: string) => ({
    type: "conversation.status_changed" as const,
    payload: { status: value },
  });
  switch (action.type) {
    case "assign_agent": {
      const assignee = await resolveAssignee(
        db,
        actor,
        members,
        action.principalId,
      );
      return (
        (await assignAgent(db, actor, conversation, assignee)) && {
          type: "conversation.assigned",
          payload: { field: "agent", cleared: "false" },
        }
      );
    }
    case "assign_team": {
      const team = await resolveTeam(db, action.teamId);
      return (
        (await assignTeam(db, actor, conversation, team)) && {
          type: "conversation.assigned",
          payload: { field: "team", cleared: "false" },
        }
      );
    }
    case "add_tag": {
      const tagId = await resolveLiveTag(db, action.tagId);
      return (
        (await attachTag(db, conversation, tagId)) && {
          type: "conversation.tags_changed",
          payload: {},
        }
      );
    }
    case "set_priority":
      return (
        (await setPriority(db, actor, conversation, action.priority)) && {
          type: "conversation.priority_changed",
          payload: { priority: action.priority },
        }
      );
    case "snooze": {
      const until = new Date(Date.now() + action.seconds * 1000);
      return (
        (await snooze(db, actor, conversation, until)) && status("snoozed")
      );
    }
    case "close":
      if (conversation.status !== "closed")
        await requireClosable(db, conversation);
      return (await setStatus(db, conversation, "closed")) && status("closed");
    case "reopen":
      return (await setStatus(db, conversation, "open")) && status("open");
  }
}

/** Claims the run's ledger key in this transaction. False: an earlier attempt already settled it. */
async function claim(db: Database, key: string) {
  const rows = await db
    .insert(hookDeliveries)
    .values({ jobId: key, hookType: "workflow", outcome: "completed" })
    .onConflictDoNothing()
    .returning({ key: hookDeliveries.jobId });
  return rows.length > 0;
}

/** Records a run that did nothing: `denied` (the acting teammate may not act) or `failed`. */
async function recordStopped(
  workspaceId: string,
  key: string,
  run: {
    eventId: string;
    workflowId: TypeId<"workflow">;
    conversationId?: TypeId<"conversation">;
  },
  kind: "denied" | "failed",
) {
  await withQuillsSystemWorkspace(workspaceId, async (db) => {
    if (!(await claim(db, key))) return;
    const [conversation] = run.conversationId
      ? await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.id, run.conversationId))
      : [];
    const [row] = await db
      .insert(workflowRuns)
      .values({
        workflowId: run.workflowId,
        conversationId: conversation?.id ?? null,
        state: "interrupted",
        cursor: { eventId: run.eventId },
        endedAt: new Date(),
      })
      .returning({ id: workflowRuns.id });
    await db.insert(workflowRunEvents).values(
      ["started", kind].map((eventKind) => ({
        runId: row!.id,
        workflowId: run.workflowId,
        kind: eventKind,
        at: sql`clock_timestamp()`,
      })),
    );
  });
  return kind;
}

/**
 * Runs one workflow for one event, once. A retry after a crash finds the ledger key that the
 * committed attempt wrote and does nothing. A 404 or 409 from an action (a removed teammate,
 * an archived tag, a required attribute) rolls back every action and records a failed run.
 * Other errors propagate, so the job retries; the last attempt records a failed run first.
 */
export async function runWorkflow(
  workspaceId: string,
  workflowId: TypeId<"workflow">,
  event: Event,
  lastAttempt: boolean,
): Promise<RunOutcome> {
  const { conversationId, messageId } = subjectOf(event);
  if (!conversationId) return "skipped";
  const key = `workflow:${event.eventId}:${workflowId}`;
  const run = { eventId: event.eventId, workflowId, conversationId };
  const actor = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const [workflow] = await db
      .select({
        id: workflows.id,
        triggerType: workflows.triggerType,
        graph: workflows.graph,
      })
      .from(workflows)
      .where(
        and(
          eq(workflows.id, workflowId),
          eq(workflows.status, "live"),
          isNull(workflows.deletedAt),
        ),
      );
    if (
      !workflow ||
      (event.type !== "workflow.run_requested" &&
        workflow.triggerType !== event.type)
    )
      return undefined;
    const principalId = await actingPrincipal(db, workflow.id);
    const [teammate] = principalId
      ? await db
          .select({ userId: principal.kaneoUserId })
          .from(principal)
          .where(eq(principal.id, principalId))
      : [];
    return {
      principalId,
      userId: teammate?.userId ?? null,
      assigns: assigns(workflow.graph),
    };
  });
  if (!actor) return "skipped";
  if (
    !actor.userId ||
    !(await teammateMayAct(workspaceId, actor.userId, "update"))
  )
    return recordStopped(workspaceId, key, run, "denied");
  // The member roster is a platform read: before the transaction, and only for assign_agent.
  const members = actor.assigns ? await memberUserIds(workspaceId) : [];
  try {
    return await withQuillsWorkspace(
      { workspaceId, userId: actor.userId },
      async (db, teammate): Promise<RunOutcome> => {
        const [workflow] = await db
          .select({ graph: workflows.graph })
          .from(workflows)
          .where(
            and(
              eq(workflows.id, workflowId),
              eq(workflows.status, "live"),
              isNull(workflows.deletedAt),
            ),
          );
        if (!workflow) return "skipped";
        // Edited since the check (another acting teammate, or the roster is now needed): retry.
        if (
          (await actingPrincipal(db, workflowId)) !== teammate.principalId ||
          assigns(workflow.graph) !== actor.assigns
        )
          throw new Error("The workflow changed during the run");
        const plan = async (lock: boolean) => {
          const conversation = await findConversation(db, conversationId, lock);
          return walk(
            workflow.graph,
            await loadContext(db, conversation, messageId),
          );
        };
        // A walk with no actions writes nothing, not even a lock or the ledger key.
        if (!(await plan(false)).actions.length) return "no_actions";
        if (!(await claim(db, key))) return "duplicate";
        const { actions, status } = await plan(true);
        if (!actions.length) return "no_actions";
        const [row] = await db
          .insert(workflowRuns)
          .values({
            workflowId,
            conversationId,
            state: "done",
            cursor: { eventId: event.eventId },
            endedAt: new Date(),
          })
          .returning({ id: workflowRuns.id });
        const kinds = ["started"];
        for (const action of actions) {
          const change = await apply(
            db,
            teammate,
            members,
            conversationId,
            action,
          );
          kinds.push(`${change ? "action" : "unchanged"}:${action.type}`);
          if (change)
            await recordQuillsChange(db, teammate, {
              type: change.type,
              entityType: "conversation",
              entityId: conversationId,
              payload: { ...change.payload, workflowRunId: row!.id },
            });
        }
        // `halted`: a condition or branch stopped the walk after the actions above.
        kinds.push(status);
        await db.insert(workflowRunEvents).values(
          kinds.map((kind) => ({
            runId: row!.id,
            workflowId,
            kind,
            at: sql`clock_timestamp()`,
          })),
        );
        return "completed";
      },
    );
  } catch (error) {
    if (error instanceof HTTPException || lastAttempt)
      await recordStopped(workspaceId, key, run, "failed");
    if (error instanceof HTTPException) return "failed";
    throw error;
  }
}
