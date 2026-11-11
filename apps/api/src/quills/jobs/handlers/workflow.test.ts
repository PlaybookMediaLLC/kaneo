import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { auditLog } from "../../../database/quills/schema/audit-log";
import {
  conversations,
  conversationTagAssignments,
  conversationTags,
} from "../../../database/quills/schema/conversation";
import { conversationAttributeDefinitions } from "../../../database/quills/schema/conversation-attributes";
import { events } from "../../../database/quills/schema/events";
import { jobQueue } from "../../../database/quills/schema/job-queue";
import { teams } from "../../../database/quills/schema/teams";
import {
  workflowRunEvents,
  workflowRuns,
} from "../../../database/quills/schema/workflows";
import * as kaneo from "../../../database/schema";
import { runWorkflow } from "../../automation/engine";
import { contractApp } from "../../framework/contract";
import quillsRouter from "../../index";
import {
  conversation,
  customer,
} from "../../support/conversation-seed.fixture";
import { fanOut, loadEvent } from "../fanout";
import { harness } from "./harness.fixture";
import { runQuillsSweeps } from "./sweeps";

let pool: Pool;
vi.mock("../../../database/index", () => ({
  getDatabasePool: () => pool,
  get schema() {
    return kaneo;
  },
  default: new Proxy(
    {},
    {
      get(_target, property) {
        const db = drizzle(pool, { schema: kaneo });
        const value = Reflect.get(db, property);
        return typeof value === "function" ? value.bind(db) : value;
      },
    },
  ),
}));
vi.mock("../../../ws", () => ({
  broadcastToUserAndWait: vi.fn(async () => {}),
}));
// A transient failure inside the run: the next `left` condition snapshots throw.
const flaky = vi.hoisted(() => ({ left: 0 }));
vi.mock("../../automation/model", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../automation/model")>();
  return {
    ...actual,
    loadContext: async (...args: Parameters<typeof actual.loadContext>) => {
      if (flaky.left > 0) {
        flaky.left--;
        throw new Error("Connection reset");
      }
      return actual.loadContext(...args);
    },
  };
});

const url = process.env.QUILLS_TEST_DATABASE_URL;
const h = harness("workflow");
const app = contractApp(quillsRouter);
const send = async (
  user: string,
  method: string,
  path: string,
  body?: unknown,
) => {
  const res = await app.request(`/quills/${h.a}${path}`, {
    method,
    headers: {
      "x-test-user": user,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const setRole = (userId: string, role: string) =>
  h
    .db()
    .update(kaneo.workspaceUserTable)
    .set({ role })
    .where(
      and(
        eq(kaneo.workspaceUserTable.workspaceId, h.a),
        eq(kaneo.workspaceUserTable.userId, userId),
      ),
    );
/** Drains until no job is left to run now. */
const settle = async () => {
  for (let pass = 0; pass < 5; pass++) {
    const { processed } = await h.drain(h.a);
    if (!processed) return;
  }
};

let ids: {
  ownerId: string;
  mateId: string;
  tagId: string;
  otherTagId: string;
  teamId: string;
};
/** A fresh conversation in A with no tag, team or priority. */
const thread = () =>
  h.as(h.a, h.owner, async (db, actor) => {
    const visitor = await customer(
      db,
      `${Date.now()}-${Math.random()}@example.test`,
    );
    return (await conversation(db, actor.principalId, visitor)).conversationId;
  });
const tagged = (conversationId: string) =>
  h.system(h.a, async (db) =>
    (
      await db
        .select({ id: conversationTagAssignments.conversationTagId })
        .from(conversationTagAssignments)
        .where(
          eq(
            conversationTagAssignments.conversationId,
            conversationId as never,
          ),
        )
    ).map((row) => row.id as string),
  );
const runsOf = (workflowId: string) =>
  h.system(h.a, async (db) => {
    const runs = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, workflowId as never));
    return Promise.all(
      runs.map(async (run) => ({
        ...run,
        kinds: (
          await db
            .select({ kind: workflowRunEvents.kind })
            .from(workflowRunEvents)
            .where(eq(workflowRunEvents.runId, run.id))
            .orderBy(workflowRunEvents.at, workflowRunEvents.id)
        ).map((row) => row.kind),
      })),
    );
  });
/** A live workflow: on the trigger (when the priority is urgent, unless `always`), the actions in order. */
const publish = async (
  publisher: string,
  actions: object[],
  triggerType = "conversation.priority_changed",
  always = false,
) => {
  const steps = [
    { id: "start", type: "trigger" },
    ...(always
      ? []
      : [
          {
            id: "urgent",
            type: "condition",
            condition: {
              field: "conversation.priority",
              op: "eq",
              value: "urgent",
            },
          },
        ]),
    ...actions.map((action, index) => ({
      id: `action${index}`,
      type: "action",
      action,
    })),
  ];
  const created = await send(publisher, "POST", "/automation/workflows", {
    name: `Workflow ${Date.now()}`,
    triggerType,
    graph: {
      nodes: steps,
      edges: steps
        .slice(1)
        .map((step, index) => ({ from: steps[index]!.id, to: step.id })),
    },
  });
  expect(created.status).toBe(200);
  const published = await send(
    publisher,
    "POST",
    `/automation/workflows/${created.body.id}/publish`,
  );
  expect(published.status).toBe(200);
  return published.body.id as string;
};
/** Tags the conversation and assigns the team on an urgent priority, then runs `extra`. */
const publishTagger = (publisher: string, extra: object[] = []) =>
  publish(publisher, [
    { type: "add_tag", tagId: ids.tagId },
    { type: "assign_team", teamId: ids.teamId },
    ...extra,
  ]);
const pause = (workflowId: string) =>
  send(h.owner, "POST", `/automation/workflows/${workflowId}/pause`);
const escalate = async (conversationId: string, user = h.owner) =>
  expect(
    (
      await send(user, "POST", `/conversations/${conversationId}/priority`, {
        priority: "urgent",
      })
    ).status,
  ).toBe(200);

describe.skipIf(!url)("workflow runs (quills.workflow)", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await h.start(pool, url!);
    const mateId = await h.principal(h.a, h.mate);
    ids = await h.as(h.a, h.owner, async (db, actor) => {
      const [tag, otherTag] = await db
        .insert(conversationTags)
        .values([
          { name: `escalated-${Date.now()}` },
          { name: `billing-${Date.now()}` },
        ])
        .returning({ id: conversationTags.id });
      const [team] = await db
        .insert(teams)
        .values({ name: `Tier 2 ${Date.now()}` })
        .returning({ id: teams.id });
      return {
        ownerId: actor.principalId,
        mateId,
        tagId: tag!.id,
        otherTagId: otherTag!.id,
        teamId: team!.id,
      };
    });
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await pool?.end();
  });

  it("runs once after commit as its publisher, through the conversation domain code", async () => {
    const workflowId = await publishTagger(h.owner);
    const conversationId = await thread();
    // A member triggers it; the actions still act as the publisher.
    await escalate(conversationId, h.mate);
    await settle();
    const [run, ...others] = await runsOf(workflowId);
    expect(others).toEqual([]);
    expect(run).toMatchObject({ state: "done", conversationId });
    expect(run!.kinds).toEqual([
      "started",
      "action:add_tag",
      "action:assign_team",
      "completed",
    ]);
    expect(await tagged(conversationId)).toEqual([ids.tagId]);
    const changes = await h.system(h.a, (db) =>
      db
        .select({
          type: events.type,
          actorId: events.actorId,
          payload: events.payload,
        })
        .from(events)
        .where(sql`${events.payload}->>'workflowRunId' = ${run!.id}`),
    );
    expect(changes.map((change) => change.type).sort()).toEqual([
      "conversation.assigned",
      "conversation.tags_changed",
    ]);
    expect(changes.every((change) => change.actorId === ids.ownerId)).toBe(
      true,
    );
    const audit = await h.system(h.a, (db) =>
      db
        .select({ actor: auditLog.actorPrincipalId })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.eventType, "conversation.tags_changed"),
            eq(auditLog.targetId, conversationId),
          ),
        ),
    );
    expect(audit.map((row) => row.actor)).toEqual([ids.ownerId]);
    // Its own changes started no second run, and the condition holds it on a lower priority.
    const calm = await thread();
    await send(h.owner, "POST", `/conversations/${calm}/priority`, {
      priority: "low",
    });
    await settle();
    expect(await runsOf(workflowId)).toHaveLength(1);
    expect(await tagged(calm)).toEqual([]);
    const report = await send(
      h.owner,
      "GET",
      "/automation/effectiveness?days=1",
    );
    expect(report.body.workflows).toContainEqual({
      workflowId,
      started: 1,
      completed: 1,
      interrupted: 0,
    });
    await pause(workflowId);
  });

  it("applies each action type through its domain code and records the route's event", async () => {
    const workflowId = await publish(h.owner, [
      { type: "assign_agent", principalId: ids.mateId },
      // Already urgent: the action changes nothing and records nothing.
      { type: "set_priority", priority: "urgent" },
      { type: "snooze", seconds: 3600 },
      { type: "reopen" },
      { type: "close" },
    ]);
    const conversationId = await thread();
    await escalate(conversationId);
    await settle();
    const [run, ...others] = await runsOf(workflowId);
    expect(others).toEqual([]);
    expect(run!.kinds).toEqual([
      "started",
      "action:assign_agent",
      "unchanged:set_priority",
      "action:snooze",
      "action:reopen",
      "action:close",
      "completed",
    ]);
    const changes = await h.system(h.a, (db) =>
      db
        .select({ type: events.type, payload: events.payload })
        .from(events)
        .where(sql`${events.payload}->>'workflowRunId' = ${run!.id}`)
        .orderBy(events.id),
    );
    expect(changes).toEqual([
      {
        type: "conversation.assigned",
        payload: { field: "agent", cleared: "false", workflowRunId: run!.id },
      },
      ...["snoozed", "open", "closed"].map((status) => ({
        type: "conversation.status_changed",
        payload: { status, workflowRunId: run!.id },
      })),
    ]);
    const [row] = await h.system(h.a, (db) =>
      db
        .select({
          status: conversations.status,
          agent: conversations.assignedAgentPrincipalId,
        })
        .from(conversations)
        .where(eq(conversations.id, conversationId as never)),
    );
    expect(row).toEqual({ status: "closed", agent: ids.mateId });
    await pause(workflowId);
  });

  it("a workflow's own change never starts a run, not even of itself", async () => {
    const workflowId = await publish(
      h.owner,
      [{ type: "add_tag", tagId: ids.tagId }],
      "conversation.tags_changed",
      true,
    );
    const conversationId = await thread();
    const added = await send(
      h.mate,
      "POST",
      `/conversations/${conversationId}/tags`,
      { tagId: ids.otherTagId },
    );
    expect(added.status).toBe(200);
    await settle();
    // Without the guard, its own tags_changed event would start a second run.
    expect(await runsOf(workflowId)).toHaveLength(1);
    expect((await tagged(conversationId)).sort()).toEqual(
      [ids.tagId, ids.otherTagId].sort(),
    );
    await pause(workflowId);
  });

  it("fails as denied when the publisher is now a viewer, and changes nothing", async () => {
    await setRole(h.mate, "admin");
    const workflowId = await publishTagger(h.mate);
    await setRole(h.mate, "viewer");
    try {
      const conversationId = await thread();
      await escalate(conversationId);
      await settle();
      const [run] = await runsOf(workflowId);
      expect(run).toMatchObject({ state: "interrupted", conversationId });
      expect(run!.kinds).toEqual(["started", "denied"]);
      expect(await tagged(conversationId)).toEqual([]);
      const [row] = await h.system(h.a, (db) =>
        db
          .select({ team: conversations.assignedTeamId })
          .from(conversations)
          .where(eq(conversations.id, conversationId as never)),
      );
      expect(row!.team).toBeNull();
    } finally {
      await setRole(h.mate, "member");
      await pause(workflowId);
    }
  });

  it("fails as denied when the publisher left the workspace", async () => {
    await setRole(h.mate, "admin");
    const workflowId = await publishTagger(h.mate);
    await h
      .db()
      .delete(kaneo.workspaceUserTable)
      .where(
        and(
          eq(kaneo.workspaceUserTable.workspaceId, h.a),
          eq(kaneo.workspaceUserTable.userId, h.mate),
        ),
      );
    try {
      const conversationId = await thread();
      await escalate(conversationId);
      await settle();
      const [run] = await runsOf(workflowId);
      expect(run!.kinds).toEqual(["started", "denied"]);
      expect(await tagged(conversationId)).toEqual([]);
    } finally {
      await h.db().insert(kaneo.workspaceUserTable).values({
        workspaceId: h.a,
        userId: h.mate,
        role: "member",
        joinedAt: new Date(),
      });
      await pause(workflowId);
    }
  });

  it("fails as denied when the publisher is banned", async () => {
    await setRole(h.mate, "admin");
    const workflowId = await publishTagger(h.mate);
    const ban = (banned: boolean) =>
      h
        .db()
        .update(kaneo.userTable)
        .set({ banned })
        .where(eq(kaneo.userTable.id, h.mate));
    await ban(true);
    try {
      const conversationId = await thread();
      await escalate(conversationId);
      await settle();
      expect((await runsOf(workflowId)).map((run) => run.kinds)).toEqual([
        ["started", "denied"],
      ]);
      expect(await tagged(conversationId)).toEqual([]);
    } finally {
      await ban(false);
      await setRole(h.mate, "member");
      await pause(workflowId);
    }
  });

  it("an instance administrator with no membership acts as the request path lets them", async () => {
    const instanceAdmin = (role: string | null) =>
      h
        .db()
        .update(kaneo.userTable)
        .set({ role })
        .where(eq(kaneo.userTable.id, h.outsider));
    await instanceAdmin("admin");
    try {
      const workflowId = await publishTagger(h.outsider);
      const conversationId = await thread();
      await escalate(conversationId);
      await settle();
      const [run] = await runsOf(workflowId);
      expect(run!.kinds).toEqual([
        "started",
        "action:add_tag",
        "action:assign_team",
        "completed",
      ]);
      // Without the instance role, the non-member may not act.
      await instanceAdmin(null);
      const again = await thread();
      await escalate(again);
      await settle();
      expect((await runsOf(workflowId)).map((run) => run.kinds)).toContainEqual(
        ["started", "denied"],
      );
      expect(await tagged(again)).toEqual([]);
      await pause(workflowId);
    } finally {
      await instanceAdmin(null);
    }
  });

  it("an edit by another teammate makes the live workflow act as that teammate", async () => {
    const workflowId = await publishTagger(h.owner);
    await setRole(h.mate, "admin");
    const edited = await send(
      h.mate,
      "PATCH",
      `/automation/workflows/${workflowId}`,
      {
        name: `Edited ${Date.now()}`,
      },
    );
    expect(edited.body).toMatchObject({
      changed: true,
      actorPrincipalId: ids.mateId,
    });
    await setRole(h.mate, "viewer");
    try {
      const conversationId = await thread();
      await escalate(conversationId);
      await settle();
      expect((await runsOf(workflowId))[0]!.kinds).toEqual([
        "started",
        "denied",
      ]);
    } finally {
      await setRole(h.mate, "member");
      await pause(workflowId);
    }
  });

  it("rolls every action back when one fails, and records a failed run", async () => {
    const [definition] = await h.as(h.a, h.owner, (db) =>
      db
        .insert(conversationAttributeDefinitions)
        .values({
          key: `reason_${Date.now()}`,
          label: "Reason",
          fieldType: "text",
          requiredToClose: true,
        })
        .returning({ id: conversationAttributeDefinitions.id }),
    );
    const workflowId = await publishTagger(h.owner, [{ type: "close" }]);
    try {
      const conversationId = await thread();
      await escalate(conversationId);
      await settle();
      const runs = await runsOf(workflowId);
      expect(runs.map((run) => [run.state, run.kinds])).toEqual([
        ["interrupted", ["started", "failed"]],
      ]);
      // No change, audit row or job of the rolled-back actions stayed.
      const leftovers = await h.system(h.a, (db) =>
        db
          .select({ type: events.type })
          .from(events)
          .where(
            and(
              eq(events.entityId, conversationId),
              sql`${events.payload} ? 'workflowRunId'`,
            ),
          ),
      );
      expect(leftovers).toEqual([]);
      const audit = await h.system(h.a, (db) =>
        db
          .select({ type: auditLog.eventType })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.targetId, conversationId),
              sql`${auditLog.eventType} <> 'conversation.priority_changed'`,
            ),
          ),
      );
      expect(audit).toEqual([]);
      // The tag and team came before the blocked close; neither stayed.
      expect(await tagged(conversationId)).toEqual([]);
      const [row] = await h.system(h.a, (db) =>
        db
          .select({
            status: conversations.status,
            team: conversations.assignedTeamId,
          })
          .from(conversations)
          .where(eq(conversations.id, conversationId as never)),
      );
      expect(row).toEqual({ status: "open", team: null });
    } finally {
      await h.system(h.a, (db) =>
        db
          .delete(conversationAttributeDefinitions)
          .where(eq(conversationAttributeDefinitions.id, definition!.id)),
      );
      await pause(workflowId);
    }
  });

  it("a replay after a committed run does nothing (lost lease)", async () => {
    const workflowId = await publishTagger(h.owner);
    const conversationId = await thread();
    await escalate(conversationId);
    const [change] = await h.system(h.a, (db) =>
      db
        .select({ eventId: events.eventId })
        .from(events)
        .where(
          and(
            eq(events.type, "conversation.priority_changed"),
            eq(events.entityId, conversationId),
          ),
        ),
    );
    // Fan the event out only: the run job is queued but has not run.
    await fanOut(h.a, change!.eventId);
    const [job] = await h.system(h.a, (db) =>
      db
        .select()
        .from(jobQueue)
        .where(
          and(
            eq(jobQueue.queue, "quills.workflow"),
            sql`${jobQueue.payload}->>'workflowId' = ${workflowId}`,
          ),
        ),
    );
    const event = await h.system(h.a, (db) =>
      loadEvent(db, (job!.payload as { eventId: string }).eventId),
    );
    // The first attempt commits, then loses its lease before it finishes the job.
    expect(await runWorkflow(h.a, workflowId as never, event!, false)).toBe(
      "completed",
    );
    await settle();
    const [after] = await h.system(h.a, (db) =>
      db.select().from(jobQueue).where(eq(jobQueue.id, job!.id)),
    );
    expect(after).toMatchObject({ status: "succeeded" });
    expect(await runsOf(workflowId)).toHaveLength(1);
    expect(await runWorkflow(h.a, workflowId as never, event!, false)).toBe(
      "duplicate",
    );
    await pause(workflowId);
  });

  it("retries a transient failure, and the last attempt records a failed run", async () => {
    const workflowId = await publishTagger(h.owner);
    const jobFor = async (conversationId: string) => {
      const [change] = await h.system(h.a, (db) =>
        db
          .select({ eventId: events.eventId })
          .from(events)
          .where(
            and(
              eq(events.type, "conversation.priority_changed"),
              eq(events.entityId, conversationId),
            ),
          ),
      );
      const [job] = await h.system(h.a, (db) =>
        db
          .select()
          .from(jobQueue)
          .where(
            and(
              eq(jobQueue.queue, "quills.workflow"),
              eq(jobQueue.dedupeKey, `${change!.eventId}:${workflowId}`),
            ),
          ),
      );
      return job!;
    };
    const first = await thread();
    flaky.left = 1;
    await escalate(first);
    await settle();
    expect(await jobFor(first)).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "quills.workflow failed",
    });
    expect(await runsOf(workflowId)).toEqual([]);
    await h.due(h.a);
    await settle();
    expect(await jobFor(first)).toMatchObject({
      status: "succeeded",
      attempts: 2,
    });
    expect((await runsOf(workflowId)).map((run) => run.kinds)).toEqual([
      ["started", "action:add_tag", "action:assign_team", "completed"],
    ]);
    // Every attempt fails: the third and last records a failed run, and the job fails.
    const second = await thread();
    flaky.left = 3;
    try {
      await escalate(second);
      await settle();
      for (let attempt = 2; attempt <= 3; attempt++) {
        await h.due(h.a);
        await settle();
      }
    } finally {
      flaky.left = 0;
    }
    expect(await jobFor(second)).toMatchObject({
      status: "failed",
      attempts: 3,
    });
    const stopped = (await runsOf(workflowId)).filter(
      (run) => run.conversationId === second,
    );
    expect(stopped.map((run) => [run.state, run.kinds])).toEqual([
      ["interrupted", ["started", "failed"]],
    ]);
    expect(await tagged(second)).toEqual([]);
    await pause(workflowId);
  });

  it("a sweep's change starts no run, so a snooze workflow cannot loop on its wake", async () => {
    const workflowId = await publish(
      h.owner,
      [{ type: "snooze", seconds: 60 }],
      "conversation.status_changed",
      true,
    );
    const conversationId = await thread();
    await h.system(h.a, (db) =>
      db
        .update(conversations)
        .set({
          status: "snoozed",
          snoozedUntil: sql`now() - interval '1 minute'`,
        })
        .where(eq(conversations.id, conversationId as never)),
    );
    expect(await runQuillsSweeps(h.a)).toEqual({ degraded: false });
    await settle();
    expect(await runsOf(workflowId)).toEqual([]);
    const [row] = await h.system(h.a, (db) =>
      db
        .select({ status: conversations.status })
        .from(conversations)
        .where(eq(conversations.id, conversationId as never)),
    );
    expect(row!.status).toBe("open");
    await pause(workflowId);
  });

  it("a run queued before a pause does nothing", async () => {
    const workflowId = await publishTagger(h.owner);
    const conversationId = await thread();
    await escalate(conversationId);
    const [change] = await h.system(h.a, (db) =>
      db
        .select({ eventId: events.eventId })
        .from(events)
        .where(
          and(
            eq(events.type, "conversation.priority_changed"),
            eq(events.entityId, conversationId),
          ),
        ),
    );
    await fanOut(h.a, change!.eventId);
    await pause(workflowId);
    await settle();
    expect(await runsOf(workflowId)).toEqual([]);
    expect(await tagged(conversationId)).toEqual([]);
  });

  it("runs a live workflow on request, as the publisher, whatever its trigger", async () => {
    const workflowId = await publishTagger(h.owner);
    const conversationId = await thread();
    // Make the condition hold without a trigger event.
    await h.system(h.a, (db) =>
      db
        .update(conversations)
        .set({ priority: "urgent" })
        .where(eq(conversations.id, conversationId as never)),
    );
    await setRole(h.mate, "viewer");
    const denied = await send(
      h.mate,
      "POST",
      `/automation/workflows/${workflowId}/run`,
      {
        conversationId,
      },
    );
    await setRole(h.mate, "member");
    expect(denied.status).toBe(403);
    const requested = await send(
      h.mate,
      "POST",
      `/automation/workflows/${workflowId}/run`,
      {
        conversationId,
      },
    );
    expect(requested.status).toBe(200);
    await settle();
    const [run] = await runsOf(workflowId);
    expect(run!.kinds).toEqual([
      "started",
      "action:add_tag",
      "action:assign_team",
      "completed",
    ]);
    await pause(workflowId);
    const paused = await send(
      h.mate,
      "POST",
      `/automation/workflows/${workflowId}/run`,
      {
        conversationId,
      },
    );
    expect(paused.status).toBe(409);
  });

  it("an event in workspace B never runs a workflow of workspace A", async () => {
    const workflowId = await publishTagger(h.owner);
    const conversationId = await thread();
    await h.emit(h.b, {
      type: "conversation.priority_changed",
      entityType: "conversation",
      entityId: conversationId,
    });
    await h.drain(h.b);
    const queued = await h.system(h.b, (db) =>
      db.select().from(jobQueue).where(eq(jobQueue.queue, "quills.workflow")),
    );
    expect(queued).toEqual([]);
    expect(await runsOf(workflowId)).toEqual([]);
    await pause(workflowId);
  });
});
