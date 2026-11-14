import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PostStatusId } from "@kaneo/ids";
import * as kaneo from "../../database/schema";
import { boards } from "../../database/quills/schema/boards";
import { events } from "../../database/quills/schema/events";
import { hookDeliveries } from "../../database/quills/schema/hook-deliveries";
import { jobQueue } from "../../database/quills/schema/job-queue";
import { postSubscriptions } from "../../database/quills/schema/notifications";
import { postTasks } from "../../database/quills/schema/platform-links";
import { posts } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import type { Database } from "../../database/quills/client";
import { publishEvent } from "../../events";
import { enqueueQuillsJob } from "../jobs/queue";
import { harness } from "../jobs/handlers/harness.fixture";

let pool: Pool;
vi.mock("../../database/index", () => ({
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
vi.mock("../../ws", () => ({
  broadcastToUserAndWait: vi.fn(async () => {}),
}));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const h = harness("tasksync");
let complete: PostStatusId;
let open: PostStatusId;
let seq = 0;

/** A Kaneo project with a to-do and a final done column, in the given workspace. */
async function project(workspaceId: string) {
  const id = `${h.a}_project_${++seq}`;
  await h
    .db()
    .insert(kaneo.projectTable)
    .values({ id, workspaceId, name: id, slug: id });
  await h
    .db()
    .insert(kaneo.columnTable)
    .values([
      { projectId: id, name: "To do", slug: "to-do", position: 0 },
      { projectId: id, name: "Done", slug: "done", position: 1, isFinal: true },
    ]);
  return id;
}
async function task(projectId: string, status = "to-do") {
  const id = `${h.a}_task_${++seq}`;
  await h
    .db()
    .insert(kaneo.taskTable)
    .values({ id, projectId, title: id, number: seq, status });
  return id;
}
const setStatus = (taskId: string, status: string) =>
  h
    .db()
    .update(kaneo.taskTable)
    .set({ status })
    .where(eq(kaneo.taskTable.id, taskId));

/** A board with the task sync setting (or none) and a post on it, linked to the task when given. */
async function post(
  workspaceId: string,
  options: { sync?: PostStatusId | null; taskId?: string },
) {
  const owner = await h.principal(
    workspaceId,
    workspaceId === h.a ? h.owner : h.outsider,
  );
  return h.system(workspaceId, async (db) => {
    const [board] = await db
      .insert(boards)
      .values({
        name: "Ideas",
        slug: `ideas-${++seq}`,
        settings: (options.sync === undefined
          ? {}
          : { taskSync: { statusOnTaskDone: options.sync } }) as never,
      })
      .returning({ id: boards.id });
    const [status] = await db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .where(eq(postStatuses.slug, "open"));
    const [row] = await db
      .insert(posts)
      .values({
        title: "Dark mode",
        content: "Please",
        boardId: board!.id,
        principalId: owner,
        statusId: status!.id,
      })
      .returning({ id: posts.id });
    if (options.taskId)
      await db
        .insert(postTasks)
        .values({ postId: row!.id, taskId: options.taskId });
    return row!.id;
  });
}
const statusOf = (workspaceId: string, postId: string) =>
  h.system(workspaceId, async (db) => {
    const [row] = await db
      .select({ statusId: posts.statusId })
      .from(posts)
      .where(eq(posts.id, postId as never));
    return row?.statusId;
  });
const syncJobs = (workspaceId: string, taskId: string) =>
  h.system(workspaceId, (db) =>
    db
      .select()
      .from(jobQueue)
      .where(
        and(
          eq(jobQueue.queue, "quills.workflow"),
          like(jobQueue.dedupeKey, `task-sync:${taskId}:%`),
        ),
      ),
  );
const statusEvents = (workspaceId: string, postId: string) =>
  h.system(workspaceId, (db) =>
    db
      .select({ payload: events.payload, actorType: events.actorType })
      .from(events)
      .where(
        and(
          eq(events.type, "post.status_changed"),
          eq(events.entityId, postId),
        ),
      ),
  );
/** Kaneo's event after a status change commits, as every task path publishes it. */
const changed = (taskId: string) =>
  publishEvent(
    "task.status_changed",
    { taskId, newStatus: "done" },
    { waitForHandlers: true },
  );
/** A task-sync job in a workspace, as the handoff writes it. */
const enqueue = (workspaceId: string, taskId: string) =>
  h.system(workspaceId, (db: Database) =>
    enqueueQuillsJob(
      db,
      "quills.workflow",
      { taskId },
      `task-sync:${taskId}:${++seq}`,
      3,
    ),
  );

describe.skipIf(!url)("Quills task sync", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await h.start(pool, url!);
    [complete, open] = await h.system(h.a, async (db) =>
      Promise.all(
        ["complete", "open"].map(
          async (slug) =>
            (
              await db
                .select({ id: postStatuses.id })
                .from(postStatuses)
                .where(eq(postStatuses.slug, slug))
            )[0]!.id,
        ),
      ),
    );
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await pool?.end();
  });
  beforeEach(async () => {
    // Earlier tests' events and jobs stay; each test reads only its own rows.
    await h.drain(h.a);
  });

  it("hands a done task with a post link to one job, and nothing else", async () => {
    const projectId = await project(h.a);
    const linked = await task(projectId);
    const unlinked = await task(projectId);
    await post(h.a, { sync: complete, taskId: linked });

    // Not done yet: no job.
    await changed(linked);
    expect(await syncJobs(h.a, linked)).toEqual([]);

    await setStatus(linked, "done");
    await setStatus(unlinked, "done");
    await changed(linked);
    await changed(unlinked);
    expect(await syncJobs(h.a, linked)).toHaveLength(1);
    expect(await syncJobs(h.a, unlinked)).toEqual([]);
  });

  it("sets the board's status on the linked post, records the change and tells followers", async () => {
    const projectId = await project(h.a);
    const taskId = await task(projectId, "done");
    const postId = await post(h.a, { sync: complete, taskId });
    const mate = await h.principal(h.a, h.mate);
    await h.system(h.a, (db) =>
      db.insert(postSubscriptions).values({
        postId: postId as never,
        principalId: mate,
        reason: "manual",
      }),
    );

    await changed(taskId);
    await h.drain(h.a);
    expect(await statusOf(h.a, postId)).toBe(complete);
    expect(await statusEvents(h.a, postId)).toEqual([
      {
        payload: { statusId: complete, source: "task" },
        actorType: "system",
      },
    ]);
    // The existing fan-out queued the follower's notification.
    await h.drain(h.a);
    const [notice] = await h.system(h.a, (db) =>
      db
        .select({ status: jobQueue.status })
        .from(jobQueue)
        .where(
          and(
            eq(jobQueue.queue, "quills.notification"),
            like(jobQueue.dedupeKey, `%:${mate}`),
          ),
        ),
    );
    expect(notice).toEqual({ status: "succeeded" });
  });

  it("changes nothing twice: a retry, a second completion and a moved-back post", async () => {
    const projectId = await project(h.a);
    const taskId = await task(projectId, "done");
    const postId = await post(h.a, { sync: complete, taskId });
    await changed(taskId);
    await h.drain(h.a);
    expect(await statusOf(h.a, postId)).toBe(complete);

    // A replayed job finds the ledger row.
    const [job] = await syncJobs(h.a, taskId);
    await h.system(h.a, (db) =>
      db
        .update(jobQueue)
        .set({ status: "pending", attempts: 0, runAt: new Date(0) })
        .where(eq(jobQueue.id, job!.id)),
    );
    // A teammate moves the post back; the task is done again.
    await h.system(h.a, (db) =>
      db
        .update(posts)
        .set({ statusId: open })
        .where(eq(posts.id, postId as never)),
    );
    await setStatus(taskId, "to-do");
    await setStatus(taskId, "done");
    await changed(taskId);
    await h.drain(h.a);
    expect(await statusOf(h.a, postId)).toBe(open);
    expect(await statusEvents(h.a, postId)).toHaveLength(1);
  });

  it("does nothing for a board without the setting, a deleted status or an unlinked post", async () => {
    const projectId = await project(h.a);
    const taskId = await task(projectId, "done");
    const plain = await post(h.a, { taskId });
    const off = await post(h.a, { sync: null, taskId });
    const unlinked = await post(h.a, { sync: complete });
    const gone = await h.system(h.a, async (db) => {
      const [status] = await db
        .insert(postStatuses)
        .values({
          name: "Gone",
          slug: `gone-${++seq}`,
          color: "#000000",
          category: "closed",
          position: 99,
          deletedAt: new Date(),
        })
        .returning({ id: postStatuses.id });
      return status!.id;
    });
    const deleted = await post(h.a, { sync: gone, taskId });
    await changed(taskId);
    await h.drain(h.a);
    for (const postId of [plain, off, unlinked, deleted])
      expect(await statusOf(h.a, postId)).toBe(open);
  });

  it("does nothing for another workspace's task, or a task that moved away or was deleted", async () => {
    const projectId = await project(h.a);
    const taskId = await task(projectId, "done");
    const postId = await post(h.a, { sync: complete, taskId });
    // A job in workspace B that names A's task: B has no link, and A's post is out of reach.
    const foreignPost = await post(h.b, { sync: complete });
    await enqueue(h.b, taskId);
    await h.drain(h.b);
    expect(await statusOf(h.a, postId)).toBe(open);
    expect(await statusOf(h.b, foreignPost)).not.toBe(complete);

    // The task's project moves to B after the handoff: the job finds no done task in A. The move
    // trigger detaches the link; it is off here, so the job's own workspace check must hold.
    await enqueue(h.a, taskId);
    await pool.query(
      "ALTER TABLE public.project DISABLE TRIGGER quills_detach_project_links",
    );
    try {
      await h
        .db()
        .update(kaneo.projectTable)
        .set({ workspaceId: h.b })
        .where(eq(kaneo.projectTable.id, projectId));
    } finally {
      await pool.query(
        "ALTER TABLE public.project ENABLE TRIGGER quills_detach_project_links",
      );
    }
    await h.drain(h.a);
    expect(await statusOf(h.a, postId)).toBe(open);

    // A deleted task.
    const other = await project(h.a);
    const deletedTask = await task(other, "done");
    const deletedPost = await post(h.a, {
      sync: complete,
      taskId: deletedTask,
    });
    await enqueue(h.a, deletedTask);
    await h
      .db()
      .delete(kaneo.taskTable)
      .where(eq(kaneo.taskTable.id, deletedTask));
    await h.drain(h.a);
    expect(await statusOf(h.a, deletedPost)).toBe(open);
  });

  it("rolls back the status, the ledger and the event when the job fails after its writes", async () => {
    const projectId = await project(h.a);
    const taskId = await task(projectId, "done");
    const postId = await post(h.a, { sync: complete, taskId });
    const job = await enqueue(h.a, taskId);
    // Another worker takes the lease: finishing the job fails after the post update.
    const { claimQuillsJob } = await import("../jobs/queue");
    const claimed = await h.system(h.a, claimQuillsJob);
    expect(claimed?.id).toBe(job!.id);
    const { runTaskSyncJob } = await import("./task-sync-job");
    await expect(
      runTaskSyncJob(h.a, { ...claimed!, leaseToken: crypto.randomUUID() }),
    ).rejects.toThrow("Quills job lease lost");
    expect(await statusOf(h.a, postId)).toBe(open);
    expect(await statusEvents(h.a, postId)).toEqual([]);
    expect(
      await h.system(h.a, (db) =>
        db
          .select()
          .from(hookDeliveries)
          .where(like(hookDeliveries.jobId, `task-sync:${taskId}:%`)),
      ),
    ).toEqual([]);

    // The real lease holder succeeds.
    await runTaskSyncJob(h.a, claimed!);
    expect(await statusOf(h.a, postId)).toBe(complete);
    expect(await statusEvents(h.a, postId)).toHaveLength(1);
  });
});
