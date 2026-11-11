import { asc, isNull } from "drizzle-orm";
import {
  workflowRunEvents,
  workflowRuns,
  workflows,
  workflowVersions,
} from "../../database/quills/schema/workflows";
import type { ContractEnv } from "../framework/contract";
import { supportSide } from "../support/conversation-seed.fixture";

// Seed helpers for the automation fixtures and feature tests. Not fixtures themselves.

/** A graph that tags the conversation when its trigger fires. */
export const tagGraph = (tagId: string) => ({
  nodes: [
    { id: "start", type: "trigger" },
    { id: "tag", type: "action", action: { type: "add_tag", tagId } },
  ],
  edges: [{ from: "start", to: "tag" }],
});

/** One workspace: a conversation, a live workflow with one version by the owner, and a run. */
async function side(env: ContractEnv, workspaceId: string) {
  const support = await supportSide(env, workspaceId, ["tags", "team"]);
  return env.scoped(workspaceId, async (db, actor) => {
    const graph = tagGraph(support.freeTagId);
    const [workflow] = await db
      .insert(workflows)
      .values({
        name: env.id("workflow"),
        class: "background",
        status: "live",
        triggerType: "conversation.status_changed",
        graph,
        createdBy: actor.principalId,
      })
      .returning();
    const [version] = await db
      .insert(workflowVersions)
      .values({
        workflowId: workflow!.id,
        name: workflow!.name,
        triggerType: workflow!.triggerType,
        triggerSettings: {},
        graph,
        createdBy: actor.principalId,
      })
      .returning({ id: workflowVersions.id });
    const [run] = await db
      .insert(workflowRuns)
      .values({
        workflowId: workflow!.id,
        conversationId: support.conversationId as never,
        state: "done",
        endedAt: new Date(),
      })
      .returning({ id: workflowRuns.id });
    await db
      .insert(workflowRunEvents)
      .values({ runId: run!.id, workflowId: workflow!.id, kind: "started" });
    const order = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(isNull(workflows.deletedAt))
      .orderBy(asc(workflows.sortOrder), asc(workflows.id));
    return {
      ...support,
      graph,
      workflowId: workflow!.id as string,
      versionId: version!.id as string,
      runId: run!.id as string,
      order: order.map((row) => row.id as string),
    };
  });
}

export const seed = async (env: ContractEnv) => ({
  a: await side(env, env.a),
  b: await side(env, env.b),
});
export type Ids = Awaited<ReturnType<typeof seed>>;
