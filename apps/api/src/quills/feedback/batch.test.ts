import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { TypeId } from "@kaneo/ids";
import { boards, postTags } from "../../database/quills/schema/boards";
import { posts, postTagAssignments } from "../../database/quills/schema/posts";
import * as kaneo from "../../database/schema";
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
let postId: TypeId<"post">;
let tags: TypeId<"post_tag">[];
let deletedTag: TypeId<"post_tag"> | undefined;
let foreignTag: TypeId<"post_tag"> | undefined;

let made = 0;
const newTags = (workspaceId: string, userId: string, n: number) =>
  world.scoped(workspaceId, userId, async (db) =>
    (
      await db
        .insert(postTags)
        .values(
          // A counter, not the clock: tag names are unique per workspace.
          Array.from({ length: n }, () => ({ name: `tag-${++made}` })),
        )
        .returning({ id: postTags.id })
    ).map((tag) => tag.id),
  );
const assigned = () =>
  world.scoped(world.a, world.users.owner, async (db) =>
    (
      await db
        .select({ tagId: postTagAssignments.tagId })
        .from(postTagAssignments)
        .where(eq(postTagAssignments.postId, postId))
    )
      .map((row) => row.tagId)
      .sort(),
  );
const setTags = (tagIds: string[]) =>
  world.request(world.users.owner, "PUT", `/posts/${postId}/tags`, { tagIds });

describe.skipIf(!url)("Feedback batch operations", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 5 });
    world = await startFeature(pool, url!, "batch");
    const { a, b, users } = world;
    postId = await world.scoped(a, users.owner, async (db, actor) => {
      const [board] = await db
        .insert(boards)
        .values({ name: "Batch", slug: `batch-${Date.now()}` })
        .returning({ id: boards.id });
      const [post] = await db
        .insert(posts)
        .values({
          title: "Batch",
          content: "Batch",
          boardId: board!.id,
          principalId: actor.principalId,
        })
        .returning({ id: posts.id });
      return post!.id;
    });
    tags = await newTags(a, users.owner, 3);
    [deletedTag] = await newTags(a, users.owner, 1);
    await world.scoped(a, users.owner, (db) =>
      db
        .update(postTags)
        .set({ deletedAt: new Date() })
        .where(eq(postTags.id, deletedTag!)),
    );
    [foreignTag] = await newTags(b, users.outsider, 1);
  }, 120000);
  afterAll(() => world?.stop());

  it("replaces the tag set and records what was added and removed", async () => {
    const [one, two, three] = tags;
    expect((await setTags([one!, two!])).status).toBe(200);
    const res = await setTags([two!, three!, three!]);
    expect(res.status).toBe(200);
    expect(res.body.tags.map((tag: { id: string }) => tag.id).sort()).toEqual(
      [two, three].sort(),
    );
    expect(await assigned()).toEqual([two, three].sort());
    const activity = (
      await world.request(world.users.owner, "GET", `/posts/${postId}/activity`)
    ).body.items.map((row: { type: string }) => row.type);
    // Rows of one transaction share a timestamp, so only the set of types is stable.
    expect(activity.slice(0, 3).sort()).toEqual([
      "tags.added",
      "tags.added",
      "tags.removed",
    ]);
  });

  it("changes nothing when one tag is foreign, deleted or missing", async () => {
    const before = await assigned();
    for (const bad of [foreignTag, deletedTag]) {
      const res = await setTags([tags[0]!, bad!]);
      expect(res.status).toBe(404);
      expect(await assigned()).toEqual(before);
    }
  });

  it("rejects more than 50 tags before reading any", async () => {
    expect(
      (await setTags(Array.from({ length: 51 }, () => tags[0]!))).status,
    ).toBe(400);
  });

  it("clears the set with an empty list", async () => {
    expect((await setTags([])).status).toBe(200);
    expect(await assigned()).toEqual([]);
  });
});
