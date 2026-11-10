import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as kaneo from "../../database/schema";
import { roadmapColumns, roadmaps } from "../../database/quills/schema/boards";
import {
  changelogEntries,
  changelogEntryPosts,
} from "../../database/quills/schema/changelog";
import { postComments } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import quillsRouter from "../index";
import {
  contractApp,
  contractEnv,
  startContract,
  stopContract,
} from "../framework/contract";
import {
  call,
  linkedProject,
  removeMembers,
  restrictedMember,
  testCustomer,
} from "./harness.fixture";
import { postIn } from "./seeds.fixture";

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
const app = contractApp(quillsRouter);

// Workspace A holds five shipped, pending posts: on a board linked to a project the member cannot
// open, on a board linked to a project the member can open, on an unlinked board, a deleted one
// and one by a test customer. The member sees only the second and the third.
let ids: {
  member: string;
  roadmapId: string;
  entryId: string;
  hiddenCommentId: string;
  hidden: { postId: string; boardId: string };
  granted: { postId: string; boardId: string };
  open: { postId: string; boardId: string };
  deleted: string;
  test: string;
};
const get = (user: string, path: string) =>
  call(app, contractEnv(), user, "GET", path);
const postIds = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

describe.skipIf(!url)(
  "Quills taxonomy reads hide what the caller may not see",
  () => {
    beforeAll(async () => {
      pool = new Pool({ connectionString: url, max: 5 });
      await startContract(pool, url!);
      const env = contractEnv();
      const [shipped] = await env.scoped(env.a, (db) =>
        db
          .insert(postStatuses)
          .values({
            name: "Shipped",
            slug: env.id("shipped"),
            category: "complete",
          })
          .returning({ id: postStatuses.id }),
      );
      const statusId = shipped!.id;
      const pending = { statusId, moderationState: "pending" as const };
      const hidden = await postIn(env, env.a, pending);
      const granted = await postIn(env, env.a, pending);
      const open = await postIn(env, env.a, pending);
      const deleted = await postIn(env, env.a, {
        ...pending,
        deletedAt: new Date(),
      });
      const tester = await testCustomer(env);
      const test = await postIn(env, env.a, {
        ...pending,
        principalId: tester,
      });
      await linkedProject(env, hidden.boardId);
      const member = await restrictedMember(env, [
        await linkedProject(env, granted.boardId),
      ]);
      const { roadmapId, entryId, hiddenCommentId } = await env.scoped(
        env.a,
        async (db, actor) => {
          const [roadmap] = await db
            .insert(roadmaps)
            .values({ name: "Visible", slug: env.id("roadmap") })
            .returning({ id: roadmaps.id });
          await db.insert(roadmapColumns).values({
            roadmapId: roadmap!.id,
            statusId,
            name: "Shipped",
            color: "#22c55e",
          });
          const all = [hidden, granted, open, deleted, test].map(
            (p) => p.postId,
          );
          const [hiddenComment] = await db
            .insert(postComments)
            .values({
              postId: hidden.postId,
              principalId: actor.principalId,
              content: "Held",
              moderationState: "pending",
            })
            .returning({ id: postComments.id });
          await db.insert(postComments).values([
            ...[granted, open].map(({ postId }) => ({
              postId,
              principalId: actor.principalId,
              content: "Held",
              moderationState: "pending" as const,
            })),
            {
              postId: open.postId,
              principalId: tester,
              content: "Test",
              moderationState: "pending",
            },
            {
              postId: open.postId,
              principalId: actor.principalId,
              content: "Gone",
              moderationState: "pending",
              deletedAt: new Date(),
            },
          ]);
          const [entry] = await db
            .insert(changelogEntries)
            .values({ title: "Release", content: "Release" })
            .returning({ id: changelogEntries.id });
          await db
            .insert(changelogEntryPosts)
            .values(
              all.map((postId) => ({ changelogEntryId: entry!.id, postId })),
            );
          return {
            roadmapId: roadmap!.id,
            entryId: entry!.id,
            hiddenCommentId: hiddenComment!.id,
          };
        },
      );
      ids = {
        member,
        roadmapId,
        entryId,
        hiddenCommentId,
        hidden,
        granted,
        open,
        deleted: deleted.postId,
        test: test.postId,
      };
    }, 120000);
    afterAll(async () => {
      await removeMembers(contractEnv());
      await stopContract();
    });

    const visible = () => [ids.granted.postId, ids.open.postId].sort();
    const leaked = (body: unknown) =>
      [ids.hidden.postId, ids.deleted, ids.test].filter((id) =>
        JSON.stringify(body).includes(id),
      );

    it("roadmap posts and their total", async () => {
      const res = await get(ids.member, `/roadmaps/${ids.roadmapId}/posts`);
      expect(res.status).toBe(200);
      expect(postIds(res.body.items)).toEqual(visible());
      expect(res.body.total).toBe(2);
      expect(leaked(res.body)).toEqual([]);
      // The owner can open every project; deleted and test posts stay out.
      const owner = await get(
        contractEnv().owner,
        `/roadmaps/${ids.roadmapId}/posts`,
      );
      expect(postIds(owner.body.items)).toEqual(
        [ids.hidden.postId, ...visible()].sort(),
      );
    });

    it("moderation queues and the pending count", async () => {
      const queue = await get(ids.member, "/moderation/pending?type=post");
      expect(postIds(queue.body.posts)).toEqual(visible());
      const comments = await get(
        ids.member,
        "/moderation/pending?type=comment",
      );
      expect(
        comments.body.comments.map((c: { postId: string }) => c.postId).sort(),
      ).toEqual(visible());
      expect(leaked([queue.body, comments.body])).toEqual([]);
      expect((await get(ids.member, "/moderation/status")).body).toEqual({
        enabled: true,
        pendingCount: 4,
      });
    });

    it("shipped-post search", async () => {
      const res = await get(ids.member, "/changelog/shipped-posts");
      expect(postIds(res.body.posts)).toEqual(visible());
      expect(leaked(res.body)).toEqual([]);
      expect(
        (
          await get(
            ids.member,
            `/changelog/shipped-posts?boardId=${ids.hidden.boardId}`,
          )
        ).status,
      ).toBe(404);
    });

    it("posts linked to a changelog entry", async () => {
      const res = await get(ids.member, `/changelog/${ids.entryId}`);
      expect(postIds(res.body.linkedPosts)).toEqual(visible());
      expect(leaked(res.body)).toEqual([]);
    });

    it("a hidden post or its comment in moderation and merge routes", async () => {
      const env = contractEnv();
      const reason = { reason: "" };
      for (const [method, path, body] of [
        ["POST", `/moderation/posts/${ids.hidden.postId}/approve`],
        ["POST", `/moderation/posts/${ids.hidden.postId}/reject`, reason],
        ["POST", `/moderation/comments/${ids.hiddenCommentId}/approve`],
        ["POST", `/moderation/comments/${ids.hiddenCommentId}/reject`, reason],
        ["GET", `/posts/${ids.hidden.postId}/merged`],
        [
          "GET",
          `/posts/${ids.open.postId}/merge-preview?into=${ids.hidden.postId}`,
        ],
      ] as const)
        expect(
          (await call(app, env, ids.member, method, path, body)).status,
        ).toBe(404);
      const queue = await get(env.owner, "/moderation/pending?type=comment");
      expect(queue.body.comments.map((c: { id: string }) => c.id)).toContain(
        ids.hiddenCommentId,
      );
    });

    it("merged posts on hidden boards, deleted and test posts under a visible post", async () => {
      const env = contractEnv();
      const canonical = await postIn(env, env.a);
      const tester = await testCustomer(env);
      const merged = {
        canonicalPostId: canonical.postId,
        mergedAt: new Date(),
      };
      const hidden = await postIn(env, env.a, merged);
      await linkedProject(env, hidden.boardId);
      await postIn(env, env.a, { ...merged, deletedAt: new Date() });
      await postIn(env, env.a, { ...merged, principalId: tester });
      const path = `/posts/${canonical.postId}/merged`;
      expect((await get(ids.member, path)).body.posts).toEqual([]);
      expect(postIds((await get(env.owner, path)).body.posts)).toEqual([
        hidden.postId,
      ]);
    });

    it("changelog links that the caller cannot see stay and cannot be added", async () => {
      const env = contractEnv();
      const send = (
        user: string,
        method: string,
        path: string,
        body?: object,
      ) => call(app, env, user, method, path, body);
      const draft = { type: "draft" };
      expect(
        (
          await send(ids.member, "POST", "/changelog", {
            title: "Hidden",
            content: "Hidden",
            publishState: draft,
            linkedPostIds: [ids.hidden.postId],
          })
        ).status,
      ).toBe(404);
      const created = await send(env.owner, "POST", "/changelog", {
        title: "Mixed",
        content: "Mixed",
        publishState: draft,
        linkedPostIds: [ids.hidden.postId, ids.granted.postId, ids.open.postId],
      });
      const path = `/changelog/${created.body.id}`;
      const edited = await send(ids.member, "PATCH", path, {
        linkedPostIds: [ids.granted.postId],
      });
      expect(postIds(edited.body.linkedPosts)).toEqual([ids.granted.postId]);
      expect(postIds((await get(env.owner, path)).body.linkedPosts)).toEqual(
        [ids.hidden.postId, ids.granted.postId].sort(),
      );
    });

    it("another teammate's private saved view", async () => {
      const env = contractEnv();
      const view = await call(app, env, env.owner, "POST", "/post-views", {
        name: "Mine only",
        filters: {},
        isShared: false,
      });
      expect(view.body).toMatchObject({ isShared: false, mine: true });
      const listed = (user: string) =>
        get(user, "/post-views?limit=100").then((res) =>
          res.body.views.map((v: { id: string }) => v.id),
        );
      expect(await listed(ids.member)).not.toContain(view.body.id);
      // An admin holds the delete action, and still does not find the view.
      const admin = await restrictedMember(env, [], "admin");
      expect(
        (await call(app, env, admin, "DELETE", `/post-views/${view.body.id}`))
          .status,
      ).toBe(404);
      expect(await listed(env.owner)).toContain(view.body.id);
    });
  },
);
