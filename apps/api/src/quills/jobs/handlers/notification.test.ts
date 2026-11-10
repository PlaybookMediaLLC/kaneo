import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { Pool } from "pg";
import type { PrincipalId } from "@kaneo/ids";
import * as kaneo from "../../../database/schema";
import { principal } from "../../../database/quills/schema/auth";
import { boards } from "../../../database/quills/schema/boards";
import { events } from "../../../database/quills/schema/events";
import { jobQueue } from "../../../database/quills/schema/job-queue";
import {
  inAppNotifications,
  notificationPreferences,
  postSubscriptions,
} from "../../../database/quills/schema/notifications";
import { boardProjects } from "../../../database/quills/schema/platform-links";
import { postComments, posts } from "../../../database/quills/schema/posts";
import { postStatuses } from "../../../database/quills/schema/statuses";
import type { BaseVariables } from "../../../openapi";
import router from "../..";
import { subscribers } from "../fanout";
import { claimQuillsJob, enqueueQuillsJob } from "../queue";
import { harness } from "./harness.fixture";
import { runNotificationJob } from "./notification";

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

const url = process.env.QUILLS_TEST_DATABASE_URL;
const h = harness("notify");
const former = `${h.owner}_former`;
let ids: {
  owner: PrincipalId;
  mate: PrincipalId;
  former: PrincipalId;
  customer: PrincipalId;
  foreign: PrincipalId;
};

// A test-only event type with its own recipients: the table is how new types plug in.
let told: PrincipalId[] = [];
let content: () => Promise<
  { type: string; title: string } | undefined
> = async () => ({ type: "test_notice", title: "Notice" });
subscribers["test.notice"] = {
  recipients: async () => ({ principalIds: told }),
  notification: () => content(),
};

const notice = (actorId = ids.owner) =>
  h.emit(h.a, {
    type: "test.notice",
    entityType: "team",
    entityId: "notice",
    actorId,
  });
const inbox = (principalId: PrincipalId) =>
  h.system(h.a, (db) =>
    db
      .select()
      .from(inAppNotifications)
      .where(eq(inAppNotifications.principalId, principalId)),
  );
const jobs = (eventId: string) =>
  h.system(h.a, (db) =>
    db
      .select()
      .from(jobQueue)
      .where(
        and(
          eq(jobQueue.queue, "quills.notification"),
          eq(jobQueue.dedupeKey, `${eventId}:${ids.mate}`),
        ),
      ),
  );

const app = new Hono<{ Variables: BaseVariables & { workspaceId: string } }>();
app.use("*", async (c, next) => {
  c.set("userId", c.req.header("x-test-user") ?? "");
  c.set("user", null);
  await next();
});
app.route("/quills", router);
const call = (path: string, user = h.mate, method = "GET", body?: object) =>
  app.request(`/quills/${h.a}${path}`, {
    method,
    headers: {
      "x-test-user": user,
      ...(body && { "content-type": "application/json" }),
    },
    body: body && JSON.stringify(body),
  });

describe.skipIf(!url)("Quills in-app notification delivery", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await h.start(pool, url!);
    await h
      .db()
      .insert(kaneo.userTable)
      .values({ id: former, name: former, email: `${former}@example.test` });
    await h.db().insert(kaneo.workspaceUserTable).values({
      workspaceId: h.a,
      userId: former,
      role: "member",
      joinedAt: new Date(),
    });
    ids = {
      owner: await h.principal(h.a, h.owner),
      mate: await h.principal(h.a, h.mate),
      former: await h.principal(h.a, former),
      foreign: await h.principal(h.b, h.outsider),
      customer: await h.system(h.a, async (db) => {
        const [row] = await db
          .insert(principal)
          .values({ displayName: "Customer", createdAt: new Date() })
          .returning({ id: principal.id });
        return row!.id;
      }),
    };
    // A teammate who left keeps a principal but is no longer told anything.
    await pool.query(
      "DELETE FROM public.workspace_member WHERE workspace_id=$1 AND user_id=$2",
      [h.a, former],
    );
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await h.db().delete(kaneo.userTable).where(eq(kaneo.userTable.id, former));
    await pool?.end();
  });
  beforeEach(async () => {
    told = [];
    content = async () => ({ type: "test_notice", title: "Notice" });
    await h.system(h.a, (db) => db.delete(inAppNotifications));
  });

  it("tells each current teammate once, never the actor, a customer, someone who left or another workspace", async () => {
    told = [ids.owner, ids.mate, ids.customer, ids.former, ids.foreign];
    const eventId = await notice();
    await h.drain(h.a);
    expect(await inbox(ids.mate)).toEqual([
      expect.objectContaining({ type: "test_notice", title: "Notice" }),
    ]);
    for (const other of [ids.owner, ids.customer, ids.former])
      expect(await inbox(other)).toEqual([]);
    expect(
      await h.system(h.b, (db) => db.select().from(inAppNotifications)),
    ).toEqual([]);

    // A replayed job finds its ledger row and inserts nothing.
    const [done] = await jobs(eventId);
    await h.system(h.a, (db) =>
      db
        .update(jobQueue)
        .set({ status: "pending", attempts: 0, runAt: new Date(0) })
        .where(eq(jobQueue.id, done!.id)),
    );
    await h.drain(h.a);
    expect(await inbox(ids.mate)).toHaveLength(1);
  });

  it("does not tell a banned teammate", async () => {
    told = [ids.mate];
    await pool.query('UPDATE public."user" SET banned=true WHERE id=$1', [
      h.mate,
    ]);
    try {
      await notice();
      await h.drain(h.a);
    } finally {
      await pool.query('UPDATE public."user" SET banned=false WHERE id=$1', [
        h.mate,
      ]);
    }
    expect(await inbox(ids.mate)).toEqual([]);
  });

  it("honors the recipient's in-app preference", async () => {
    told = [ids.mate];
    await h.system(h.a, (db) =>
      db.insert(notificationPreferences).values({
        principalId: ids.mate,
        matrix: { test_notice: { inApp: false } },
      }),
    );
    try {
      const eventId = await notice();
      await h.drain(h.a);
      expect(await inbox(ids.mate)).toEqual([]);
      expect((await jobs(eventId))[0]!.status).toBe("succeeded");
    } finally {
      await h.system(h.a, (db) => db.delete(notificationPreferences));
    }
  });

  it("rolls back a notification whose lease was lost, then inserts it once", async () => {
    const eventId = await notice();
    await h.system(h.a, async (db) => {
      await db
        .update(events)
        .set({ publishedAt: new Date() })
        .where(eq(events.eventId, eventId));
      await enqueueQuillsJob(
        db,
        "quills.notification",
        { eventId, principalId: ids.mate },
        `${eventId}:${ids.mate}`,
        3,
      );
    });
    let stale = await h.system(h.a, claimQuillsJob);
    while (stale && stale.queue !== "quills.notification") {
      await h.system(h.a, (db) =>
        db
          .update(jobQueue)
          .set({
            status: "succeeded",
            leaseToken: null,
            lockedUntil: null,
            lockedBy: null,
          })
          .where(eq(jobQueue.id, stale!.id)),
      );
      stale = await h.system(h.a, claimQuillsJob);
    }
    await h.system(h.a, (db) =>
      db
        .update(jobQueue)
        .set({ lockedUntil: new Date(0) })
        .where(eq(jobQueue.id, stale!.id)),
    );
    await expect(runNotificationJob(h.a, stale!)).rejects.toThrow("lease lost");
    expect(await inbox(ids.mate)).toEqual([]);
    await h.drain(h.a);
    expect(await inbox(ids.mate)).toHaveLength(1);
  });

  it("retries a failing handler up to its attempt limit", async () => {
    told = [ids.mate];
    content = async () => {
      throw new Error("content unavailable");
    };
    const eventId = await notice();
    await h.drain(h.a);
    expect((await jobs(eventId))[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "quills.notification failed",
    });
    await h.due(h.a);
    await h.drain(h.a);
    await h.due(h.a);
    await h.drain(h.a);
    expect((await jobs(eventId))[0]).toMatchObject({
      status: "failed",
      attempts: 3,
    });
    expect(await inbox(ids.mate)).toEqual([]);
  });

  it("fails an invalid payload at once", async () => {
    const [row] = await h.system(h.a, (db) =>
      db
        .insert(jobQueue)
        .values({
          jobId: `job_${Date.now()}`,
          queue: "quills.notification",
          payload: { eventId: "x", principalId: "not-a-principal" },
          dedupeKey: "invalid",
          maxAttempts: 3,
        })
        .returning(),
    );
    await h.drain(h.a);
    const [after] = await h.system(h.a, (db) =>
      db.select().from(jobQueue).where(eq(jobQueue.id, row!.id)),
    );
    expect(after).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "Invalid job payload",
    });
  });

  it("tells post subscribers about status changes and comments, only while they can see the board", async () => {
    const post = await h.as(h.a, h.owner, async (db, actor) => {
      const [board] = await db
        .insert(boards)
        .values({ name: "Ideas", slug: `ideas-${Date.now()}` })
        .returning({ id: boards.id });
      const [status] = await db
        .select({ id: postStatuses.id, name: postStatuses.name })
        .from(postStatuses)
        .limit(1);
      const [row] = await db
        .insert(posts)
        .values({
          title: "Dark mode",
          content: "Please",
          boardId: board!.id,
          principalId: actor.principalId,
          statusId: status!.id,
        })
        .returning({ id: posts.id });
      const [comment] = await db
        .insert(postComments)
        .values({
          postId: row!.id,
          principalId: actor.principalId,
          content: "Planned for next month",
        })
        .returning({ id: postComments.id });
      for (const principalId of [actor.principalId, ids.mate])
        await db.insert(postSubscriptions).values({
          postId: row!.id,
          principalId,
          reason: "manual",
        });
      return {
        id: row!.id,
        boardId: board!.id,
        status: status!.name,
        comment: comment!.id,
      };
    });
    await h.emit(h.a, {
      type: "post.status_changed",
      entityType: "post",
      entityId: post.id,
      actorId: ids.owner,
    });
    await h.emit(h.a, {
      type: "comment.created",
      entityType: "comment",
      entityId: post.comment,
      actorId: ids.owner,
    });
    await h.drain(h.a);
    expect(
      (await inbox(ids.mate)).map(({ type, title, postId }) => ({
        type,
        title,
        postId,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          type: "post_status_changed",
          title: `Status changed to ${post.status}`,
          postId: post.id,
        },
        {
          type: "comment_created",
          title: expect.stringContaining("commented"),
          postId: post.id,
        },
      ]),
    );
    expect(await inbox(ids.owner)).toEqual([]);
    expect((await call(`/posts/${post.id}/subscription`)).status).toBe(200);
    const listed = await (await call("/notifications")).json();
    expect(listed).toMatchObject({ total: 2, unreadCount: 2 });
    expect(JSON.stringify(listed)).toContain("Dark mode");

    // Link the board to a project the teammate cannot open.
    const project = `${h.a}_private`;
    await h.db().insert(kaneo.projectTable).values({
      id: project,
      workspaceId: h.a,
      name: "Private",
      slug: project,
    });
    await h.db().insert(kaneo.workspaceMemberAccessTable).values({
      workspaceId: h.a,
      userId: h.mate,
      projectAccess: "selected",
    });
    await h.system(h.a, (db) =>
      db
        .insert(boardProjects)
        .values({ boardId: post.boardId, projectId: project }),
    );
    // The board is hidden from the teammate; the owner can still open its project.
    for (const method of ["GET", "PUT", "DELETE"])
      expect(
        (
          await call(
            `/posts/${post.id}/subscription`,
            h.mate,
            method,
            method === "PUT" ? { level: "all" } : undefined,
          )
        ).status,
      ).toBe(404);
    expect((await call(`/posts/${post.id}/subscription`, h.owner)).status).toBe(
      200,
    );
    const hidden = await (await call("/notifications")).json();
    expect(JSON.stringify(hidden)).not.toContain("Dark mode");
    expect(JSON.stringify(hidden)).not.toContain(post.id);
    expect(hidden.notifications[0]).toMatchObject({
      title: "Notification",
      postId: null,
      post: null,
    });
    await h.emit(h.a, {
      type: "post.status_changed",
      entityType: "post",
      entityId: post.id,
      actorId: ids.owner,
    });
    await h.drain(h.a);
    expect(await inbox(ids.mate)).toHaveLength(2);

    // Another teammate's notification is not found, and the caller's own is.
    const [mine] = await inbox(ids.mate);
    expect(
      (await call(`/notifications/${mine!.id}/read`, h.owner, "POST")).status,
    ).toBe(404);
    expect(
      (await call(`/notifications/${mine!.id}/read`, h.mate, "POST")).status,
    ).toBe(200);
    expect(await (await call("/notifications/unread-count")).json()).toEqual({
      count: 1,
    });
  });
});
