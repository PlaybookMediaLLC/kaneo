import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { generateId } from "@kaneo/ids";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { auditLog } from "../../../database/quills/schema/audit-log";
import { changelogEntries } from "../../../database/quills/schema/changelog";
import { conversations } from "../../../database/quills/schema/conversation";
import { events } from "../../../database/quills/schema/events";
import {
  statusComponents,
  statusIncidentComponents,
  statusIncidents,
  statusIncidentUpdates,
} from "../../../database/quills/schema/status";
import * as kaneo from "../../../database/schema";
import { jobQueue } from "../../../database/quills/schema/job-queue";
import { kvStore } from "../../../database/quills/schema/kv";
import { recordQuillsChange } from "../../events";
import { enqueueQuillsJob } from "../queue";
import {
  conversation,
  customer,
} from "../../support/conversation-seed.fixture";
import { digestWeek } from "./digest";
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

// Change types whose recording fails, to break one sweep after its first write.
const failing = vi.hoisted(() => new Set<string>());
vi.mock("../../events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../events")>();
  return {
    ...actual,
    recordQuillsChange: async (
      ...args: Parameters<typeof actual.recordQuillsChange>
    ) => {
      if (failing.has(args[2].type)) throw new Error("Injected failure");
      return actual.recordQuillsChange(...args);
    },
  };
});

const url = process.env.QUILLS_TEST_DATABASE_URL;
const h = harness("sweeps");
const minutes = (n: number) => sql`now() + make_interval(mins => ${n})`;
const runnable = async () =>
  (await pool.query("SELECT quills.runnable_workspaces('') AS id")).rows.map(
    (row) => row.id as string,
  );
/** Changes recorded with no actor in a workspace, by type and entity. */
const systemChanges = (workspaceId: string) =>
  h.system(workspaceId, (db) =>
    db
      .select({
        type: events.type,
        entityId: events.entityId,
        payload: events.payload,
      })
      .from(events)
      .where(eq(events.actorType, "system")),
  );

/** A snoozed conversation in a workspace whose wake time is `wake` minutes from now. */
const snoozed = (workspaceId: string, userId: string, wake: number) =>
  h.as(workspaceId, userId, async (db, actor) => {
    const visitor = await customer(
      db,
      `${Date.now()}-${Math.random()}@example.test`,
    );
    const { conversationId } = await conversation(
      db,
      actor.principalId,
      visitor,
      {
        status: "snoozed",
        snoozedUntil: minutes(wake) as never,
      },
    );
    return conversationId as string;
  });
const statusOf = (workspaceId: string, id: string) =>
  h.system(workspaceId, async (db) => {
    const [row] = await db
      .select({
        status: conversations.status,
        until: conversations.snoozedUntil,
      })
      .from(conversations)
      .where(eq(conversations.id, id as never));
    return row;
  });

describe.skipIf(!url)("Quills sweeps", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    await h.start(pool, url!);
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await pool?.end();
  });

  it("wakes due snoozes once, only in the swept workspace", async () => {
    const due = await snoozed(h.a, h.owner, -1);
    const later = await snoozed(h.a, h.owner, 60);
    const foreign = await snoozed(h.b, h.outsider, -1);
    expect(await runnable()).toEqual(expect.arrayContaining([h.a, h.b]));
    expect(await runQuillsSweeps(h.a)).toEqual({ degraded: false });
    expect(await statusOf(h.a, due)).toEqual({ status: "open", until: null });
    expect((await statusOf(h.a, later))!.status).toBe("snoozed");
    expect((await statusOf(h.b, foreign))!.status).toBe("snoozed");
    await runQuillsSweeps(h.a);
    expect(
      (await systemChanges(h.a)).filter((change) => change.entityId === due),
    ).toEqual([
      {
        type: "conversation.status_changed",
        entityId: due,
        payload: { status: "open" },
      },
    ]);
    await runQuillsSweeps(h.b);
    expect((await statusOf(h.b, foreign))!.status).toBe("open");
  });

  it("announces a scheduled changelog entry once when its time passes", async () => {
    await h.drain(h.a);
    const [scheduled, immediate, old, future] = await h.as(
      h.a,
      h.owner,
      async (db, actor) => {
        const rows = await db
          .insert(changelogEntries)
          .values(
            [-1, -2, -60 * 48, 60].map((at, index) => ({
              title: `Entry ${index}`,
              content: "Body",
              principalId: actor.principalId,
              publishedAt: minutes(at) as never,
            })),
          )
          .returning({ id: changelogEntries.id });
        // Published at once: the route recorded its event already.
        await recordQuillsChange(db, actor, {
          type: "changelog.published",
          entityType: "changelog",
          entityId: rows[1]!.id,
          payload: { notify: "false" },
        });
        return rows.map((row) => row.id as string) as [
          string,
          string,
          string,
          string,
        ];
      },
    );
    // Only the unannounced entries are due now (the route's own event is delivered first).
    await h.drain(h.a);
    expect(await runnable()).toContain(h.a);
    await runQuillsSweeps(h.a);
    await runQuillsSweeps(h.a);
    await h.drain(h.a);
    expect(await runnable()).not.toContain(h.a);
    const published = await h.system(h.a, (db) =>
      db
        .select({ entityId: events.entityId, actorType: events.actorType })
        .from(events)
        .where(eq(events.type, "changelog.published")),
    );
    expect(published).toEqual(
      expect.arrayContaining([
        { entityId: scheduled, actorType: "system" },
        { entityId: immediate, actorType: "user" },
      ]),
    );
    expect(published).toHaveLength(2);
    const stamped = await h.system(h.a, (db) =>
      db
        .select({
          id: changelogEntries.id,
          notifiedAt: changelogEntries.notifiedAt,
        })
        .from(changelogEntries)
        .where(
          inArray(changelogEntries.id, [
            scheduled,
            immediate,
            old,
            future,
          ] as never[]),
        ),
    );
    const notified = new Map(
      stamped.map((row) => [row.id as string, row.notifiedAt]),
    );
    expect(notified.get(scheduled)).not.toBeNull();
    expect(notified.get(immediate)).not.toBeNull();
    // Older than a day (before this sweep existed) and not yet due: left alone.
    expect(notified.get(old)).toBeNull();
    expect(notified.get(future)).toBeNull();
  });

  it("starts and completes maintenance windows at their bounds", async () => {
    const ids = await h.as(h.a, h.owner, async (db) => {
      const [component] = await db
        .insert(statusComponents)
        .values({ name: "API" })
        .returning({ id: statusComponents.id });
      const window = (
        title: string,
        values: Partial<typeof statusIncidents.$inferInsert>,
      ) =>
        db
          .insert(statusIncidents)
          .values({
            kind: "maintenance",
            title,
            status: "scheduled",
            ...values,
          })
          .returning({ id: statusIncidents.id })
          .then(async ([row]) => {
            await db.insert(statusIncidentComponents).values({
              incidentId: row!.id,
              componentId: component!.id,
              componentStatus: "under_maintenance",
            });
            return row!.id as string;
          });
      return {
        component: component!.id as string,
        starting: await window("Starting", {
          scheduledStartAt: minutes(-1) as never,
          scheduledEndAt: minutes(60) as never,
        }),
        manual: await window("Manual", {
          scheduledStartAt: minutes(-1) as never,
          scheduledEndAt: minutes(60) as never,
          autoStart: false,
        }),
        missed: await window("Missed", {
          scheduledStartAt: minutes(-120) as never,
          scheduledEndAt: minutes(-60) as never,
        }),
        // Planned two days ago with no end: too late to start on its own.
        stale: await window("Stale", {
          scheduledStartAt: minutes(-60 * 48) as never,
        }),
      };
    });
    const read = () =>
      h.system(h.a, async (db) => {
        const rows = await db
          .select({ id: statusIncidents.id, status: statusIncidents.status })
          .from(statusIncidents)
          .where(
            inArray(statusIncidents.id, [
              ids.starting,
              ids.manual,
              ids.missed,
              ids.stale,
            ] as never[]),
          );
        const [component] = await db
          .select({ status: statusComponents.status })
          .from(statusComponents)
          .where(eq(statusComponents.id, ids.component as never));
        return {
          ...Object.fromEntries(
            rows.map((row) => [row.id as string, row.status]),
          ),
          component: component!.status,
        };
      });
    // Only the windows are due: queued work from earlier tests is delivered first.
    await h.drain(h.a);
    expect(await runnable()).toContain(h.a);
    await runQuillsSweeps(h.a);
    expect(await read()).toEqual({
      [ids.starting]: "in_progress",
      [ids.manual]: "scheduled",
      // Its end passed too: completed without a start, so the component never moved.
      [ids.missed]: "completed",
      [ids.stale]: "scheduled",
      component: "under_maintenance",
    });
    // The running window reaches its end.
    await h.system(h.a, (db) =>
      db
        .update(statusIncidents)
        .set({ scheduledEndAt: minutes(-1) as never })
        .where(eq(statusIncidents.id, ids.starting as never)),
    );
    await runQuillsSweeps(h.a);
    await runQuillsSweeps(h.a);
    expect(await read()).toMatchObject({
      [ids.starting]: "completed",
      component: "operational",
    });
    const changes = (await systemChanges(h.a)).filter((change) =>
      [ids.starting, ids.missed].includes(change.entityId),
    );
    expect(changes.map((change) => [change.type, change.entityId])).toEqual(
      expect.arrayContaining([
        ["status.maintenance_started", ids.starting],
        ["status.incident_resolved", ids.starting],
        ["status.incident_resolved", ids.missed],
      ]),
    );
    expect(changes).toHaveLength(3);
    const updates = await h.system(h.a, (db) =>
      db
        .select({
          status: statusIncidentUpdates.status,
          by: statusIncidentUpdates.createdBy,
        })
        .from(statusIncidentUpdates)
        .where(eq(statusIncidentUpdates.incidentId, ids.starting as never)),
    );
    expect(updates).toEqual(
      expect.arrayContaining([
        { status: "in_progress", by: null },
        { status: "completed", by: null },
      ]),
    );
    // Nothing is due any more: the manual window waits for a teammate.
    await h.drain(h.a);
    expect(await runnable()).not.toContain(h.a);
  });

  it("a failing sweep rolls back alone and the others still run", async () => {
    const due = await snoozed(h.a, h.owner, -1);
    const [entry] = await h.as(h.a, h.owner, (db, actor) =>
      db
        .insert(changelogEntries)
        .values({
          title: "Scheduled",
          content: "Body",
          principalId: actor.principalId,
          publishedAt: minutes(-1) as never,
        })
        .returning({ id: changelogEntries.id }),
    );
    const notified = async () =>
      (
        await h.system(h.a, (db) =>
          db
            .select({ at: changelogEntries.notifiedAt })
            .from(changelogEntries)
            .where(eq(changelogEntries.id, entry!.id)),
        )
      )[0]!.at;
    failing.add("changelog.published");
    try {
      expect(await runQuillsSweeps(h.a)).toEqual({ degraded: true });
    } finally {
      failing.clear();
    }
    expect((await statusOf(h.a, due))!.status).toBe("open");
    expect(await notified()).toBeNull();
    expect(await runQuillsSweeps(h.a)).toEqual({ degraded: false });
    expect(await notified()).not.toBeNull();
    expect(
      (await systemChanges(h.a)).filter(
        (change) => change.entityId === entry!.id,
      ),
    ).toHaveLength(1);
  });

  it("lists a workspace whose only due work is a workflow run", async () => {
    await h.drain(h.a);
    expect(await runnable()).not.toContain(h.a);
    await h.system(h.a, (db) =>
      enqueueQuillsJob(
        db,
        "quills.workflow",
        { eventId: "probe", workflowId: "probe" },
        "sweeps-probe",
        1,
      ),
    );
    try {
      expect(await runnable()).toContain(h.a);
    } finally {
      await h.system(h.a, (db) =>
        db.delete(jobQueue).where(eq(jobQueue.dedupeKey, "sweeps-probe")),
      );
    }
  });

  it("lists a quiet workspace until its weekly digest is done", async () => {
    const { week, from } = digestWeek();
    await h.drain(h.a);
    expect(await runnable()).not.toContain(h.a);
    // Earlier sweeps marked last week done. The audit history is append-only, so the row stays.
    await h.system(h.a, async (db) => {
      await db.delete(kvStore).where(eq(kvStore.key, `digest:${week}`));
      await db.insert(auditLog).values({
        eventType: "post.status_changed",
        targetType: "post",
        targetId: generateId("post"),
        occurredAt: new Date(from.getTime() + 60_000),
        actorType: "user",
      });
    });
    expect(await runnable()).toContain(h.a);
    // No one voted for or follows the post, so the sweep queues nothing and marks the week done.
    await runQuillsSweeps(h.a);
    expect(await runnable()).not.toContain(h.a);
  });

  it("skips an archived workspace", async () => {
    const due = await snoozed(h.b, h.outsider, -1);
    await h
      .db()
      .update(kaneo.workspaceTable)
      .set({ archivedAt: new Date() })
      .where(eq(kaneo.workspaceTable.id, h.b));
    try {
      expect(await runnable()).not.toContain(h.b);
      expect(await runQuillsSweeps(h.b)).toEqual({ degraded: true });
    } finally {
      await h
        .db()
        .update(kaneo.workspaceTable)
        .set({ archivedAt: null })
        .where(eq(kaneo.workspaceTable.id, h.b));
    }
    expect((await statusOf(h.b, due))!.status).toBe("snoozed");
    expect(
      (
        await h.system(h.b, (db) =>
          db
            .select({ id: events.id })
            .from(events)
            .where(
              and(eq(events.actorType, "system"), eq(events.entityId, due)),
            ),
        )
      ).length,
    ).toBe(0);
  });
});
