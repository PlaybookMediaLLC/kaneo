import { eq } from "drizzle-orm";
import { changelogEntries } from "../../database/quills/schema/changelog";
import { changelogCategories } from "../../database/quills/schema/changelog-categories";
import { postStatuses } from "../../database/quills/schema/statuses";
import { fixture, type ContractEnv } from "../framework/contract";
import { postIn } from "./seeds.fixture";

/** A draft entry, a category and a shipped post, in one workspace. */
async function entryIn(env: ContractEnv, workspaceId: string) {
  const [complete] = await env.scoped(workspaceId, (db) =>
    db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .where(eq(postStatuses.category, "complete"))
      .limit(1),
  );
  const { boardId, postId } = await postIn(env, workspaceId, {
    statusId: complete!.id,
  });
  return env.scoped(workspaceId, async (db, actor) => {
    const [entry] = await db
      .insert(changelogEntries)
      .values({
        title: "Contract",
        content: "Contract",
        principalId: actor.principalId,
      })
      .returning({ id: changelogEntries.id });
    const [category] = await db
      .insert(changelogCategories)
      .values({ name: env.id("category"), color: "#6b7280" })
      .returning({ id: changelogCategories.id });
    return { entryId: entry!.id, categoryId: category!.id, boardId, postId };
  });
}
const seed = async (env: ContractEnv) => ({
  a: await entryIn(env, env.a),
  b: await entryIn(env, env.b),
});
type Ids = Awaited<ReturnType<typeof seed>>;
const byEntry = (body?: object) =>
  fixture({
    seed,
    valid: ({ a }: Ids) => ({ params: { entryId: a.entryId }, body }),
    foreign: ({ b }: Ids) => ({ entryId: b.entryId }),
  });
const byCategory = (body?: object) =>
  fixture({
    seed,
    valid: ({ a }: Ids) => ({ params: { categoryId: a.categoryId }, body }),
    foreign: ({ b }: Ids) => ({ categoryId: b.categoryId }),
  });

export const listQuillsChangelog = fixture({ seed, valid: () => ({}) });
export const getQuillsChangelogEntry = byEntry();
export const createQuillsChangelogEntry = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    body: {
      title: "Shipped",
      content: "Now live",
      publishState: { type: "published" },
      linkedPostIds: [a.postId],
      categoryIds: [a.categoryId],
    },
  }),
});
export const updateQuillsChangelogEntry = byEntry({ title: "Renamed" });
export const deleteQuillsChangelogEntry = byEntry();
export const searchQuillsShippedPosts = fixture({
  seed,
  valid: ({ a }: Ids) => ({ query: { boardId: a.boardId } }),
  foreign: ({ b }: Ids) => ({ boardId: b.boardId }),
});
export const listQuillsChangelogCategories = fixture({
  seed,
  valid: () => ({}),
});
export const createQuillsChangelogCategory = fixture({
  seed: async (env) => env.id("category"),
  valid: (name: string) => ({ body: { name, color: "#22c55e" } }),
});
export const updateQuillsChangelogCategory = byCategory({ color: "#22c55e" });
export const deleteQuillsChangelogCategory = byCategory();
export const reorderQuillsChangelogCategories = fixture({
  // Start from two categories, so the full list stays within the 50-ID bound.
  seed: async (env) => {
    await env.scoped(env.a, (db) => db.delete(changelogCategories));
    const first = await entryIn(env, env.a);
    const second = await entryIn(env, env.a);
    return [second.categoryId, first.categoryId];
  },
  valid: (categoryIds: string[]) => ({ body: { categoryIds } }),
});
export const getQuillsChangelogSettings = fixture({
  seed: async () => ({}),
  valid: () => ({}),
});
export const updateQuillsChangelogSettings = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { audience: "authenticated", autoSubscribe: false } }),
});
