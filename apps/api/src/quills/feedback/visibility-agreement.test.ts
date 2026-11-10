import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createId, type TypeId } from "@kaneo/ids";
import { withQuillsSystemWorkspace } from "../../database/quills/client";
import { boards } from "../../database/quills/schema/boards";
import { events } from "../../database/quills/schema/events";
import { jobQueue } from "../../database/quills/schema/job-queue";
import {
  inAppNotifications,
  postSubscriptions,
} from "../../database/quills/schema/notifications";
import { boardProjects } from "../../database/quills/schema/platform-links";
import { posts } from "../../database/quills/schema/posts";
import * as kaneo from "../../database/schema";
import { fanOut } from "../jobs/fanout";
import { startFeature } from "./harness.fixture";

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
const url = process.env.QUILLS_TEST_DATABASE_URL;
let world: Awaited<ReturnType<typeof startFeature>>;
const cases = ["unlinked", "open", "private", "deleted"] as const;
let postOf: Record<(typeof cases)[number], TypeId<"post">>;
let member: TypeId<"principal">;
let owner: TypeId<"principal">;

// The member can open only the open project. One pending post on each board.
// The member follows each post and has one inbox notification about it.
describe.skipIf(!url)("Board visibility agrees across call sites", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    world = await startFeature(pool, url!, "agreement");
    const { a, users, projects } = world;
    member = await world.scoped(
      a,
      users.member,
      async (_db, actor) => actor.principalId,
    );
    ({ owner, postOf } = await world.scoped(
      a,
      users.owner,
      async (db, actor) => {
        const post = async (link?: string, deleted = false) => {
          const [board] = await db
            .insert(boards)
            .values({
              name: "Agreement",
              slug: `agreement-${createId("board")}`,
              deletedAt: deleted ? new Date() : null,
            })
            .returning({ id: boards.id });
          if (link)
            await db
              .insert(boardProjects)
              .values({ boardId: board!.id, projectId: link });
          const [row] = await db
            .insert(posts)
            .values({
              title: "Agreement",
              content: "Agreement",
              boardId: board!.id,
              principalId: actor.principalId,
              moderationState: "pending",
            })
            .returning({ id: posts.id });
          await db.insert(postSubscriptions).values({
            postId: row!.id,
            principalId: member,
            reason: "manual",
          });
          await db.insert(inAppNotifications).values({
            principalId: member,
            type: "post_status_changed",
            title: "Agreement",
            postId: row!.id,
          });
          return row!.id;
        };
        return {
          owner: actor.principalId,
          postOf: {
            unlinked: await post(),
            open: await post(projects.open),
            private: await post(projects.hidden),
            deleted: await post(undefined, true),
          },
        };
      },
    ));
  }, 120000);
  afterAll(() => world?.stop());

  /** True when fan-out enqueues an in-app notification for the member about the post. */
  const told = async (postId: TypeId<"post">) => {
    const eventId = createId("event");
    await withQuillsSystemWorkspace(world.a, (db) =>
      db.insert(events).values({
        eventId,
        type: "post.status_changed",
        entityType: "post",
        entityId: postId,
        actorType: "user",
        actorId: owner,
        payload: {},
        context: { deliver: true },
      }),
    );
    await fanOut(world.a, eventId);
    const jobs = await withQuillsSystemWorkspace(world.a, (db) =>
      db
        .select({ id: jobQueue.id })
        .from(jobQueue)
        .where(
          and(
            eq(jobQueue.queue, "quills.notification"),
            eq(jobQueue.dedupeKey, `${eventId}:${member}`),
          ),
        ),
    );
    return jobs.length === 1;
  };

  it("gives the same answer for a post read, its subscription, the moderation list, the inbox and fan-out", async () => {
    const as = (path: string) => world.request(world.users.member, "GET", path);
    const pending = (await as("/moderation/pending")).body.posts.map(
      (post: { id: string }) => post.id,
    );
    const inbox = (await as("/notifications?limit=100")).body.notifications.map(
      (item: { post: { id: string } | null }) => item.post?.id,
    );
    const seen: Record<string, unknown[]> = {};
    for (const name of cases) {
      const id = postOf[name];
      seen[name] = [
        (await as(`/posts/${id}`)).status,
        (await as(`/posts/${id}/subscription`)).status,
        pending.includes(id),
        inbox.includes(id),
        await told(id),
      ];
    }
    expect(seen).toEqual({
      unlinked: [200, 200, true, true, true],
      open: [200, 200, true, true, true],
      private: [404, 404, false, false, false],
      deleted: [404, 404, false, false, false],
    });
  });
});
