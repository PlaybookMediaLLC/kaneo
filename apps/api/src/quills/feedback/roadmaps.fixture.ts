import { isNull } from "drizzle-orm";
import { roadmapColumns, roadmaps } from "../../database/quills/schema/boards";
import { fixture, type ContractEnv } from "../framework/contract";
import { postIn, softDeletes, statusIn } from "./seeds.fixture";

/** A roadmap with one status column, and a post in that column, in one workspace. */
async function roadmapIn(env: ContractEnv, workspaceId: string) {
  const statusId = await statusIn(env, workspaceId);
  const { postId } = await postIn(env, workspaceId, { statusId });
  const ids = await env.scoped(workspaceId, async (db) => {
    const [roadmap] = await db
      .insert(roadmaps)
      .values({ name: "Contract", slug: env.id("roadmap") })
      .returning({ id: roadmaps.id });
    const [column] = await db
      .insert(roadmapColumns)
      .values({
        roadmapId: roadmap!.id,
        statusId,
        name: "Planned",
        color: "#a855f7",
      })
      .returning({ id: roadmapColumns.id });
    return { roadmapId: roadmap!.id, columnId: column!.id };
  });
  return { ...ids, postId, freeStatusId: await statusIn(env, workspaceId) };
}
const seed = async (env: ContractEnv) => ({
  a: await roadmapIn(env, env.a),
  b: await roadmapIn(env, env.b),
});
type Ids = Awaited<ReturnType<typeof seed>>;
const softDelete = softDeletes("roadmaps", ({ a }: Ids) => a.roadmapId);
const byRoadmap = (body?: object) =>
  fixture({
    seed,
    valid: ({ a }: Ids) => ({ params: { roadmapId: a.roadmapId }, body }),
    foreign: ({ b }: Ids) => ({ roadmapId: b.roadmapId }),
    softDelete,
  });
const byColumn = (body?: object) =>
  fixture({
    seed,
    valid: ({ a }: Ids) => ({
      params: { roadmapId: a.roadmapId, columnId: a.columnId },
      body,
    }),
    foreign: ({ b }: Ids) => ({ roadmapId: b.roadmapId, columnId: b.columnId }),
    softDelete,
  });

export const listQuillsRoadmaps = fixture({ seed, valid: () => ({}) });
export const getQuillsRoadmap = byRoadmap();
export const createQuillsRoadmap = fixture({
  seed: async (env) => env.id("roadmap").replaceAll("_", "-"),
  valid: (slug: string) => ({ body: { name: "Roadmap", slug } }),
});
export const updateQuillsRoadmap = byRoadmap({ name: "Renamed" });
export const deleteQuillsRoadmap = byRoadmap();
export const reorderQuillsRoadmaps = fixture({
  // Retire earlier roadmaps, so the full list stays within the 50-ID bound.
  seed: async (env) => {
    await env.scoped(env.a, (db) =>
      db
        .update(roadmaps)
        .set({ deletedAt: new Date() })
        .where(isNull(roadmaps.deletedAt)),
    );
    const first = await roadmapIn(env, env.a);
    const second = await roadmapIn(env, env.a);
    return [second.roadmapId, first.roadmapId];
  },
  valid: (roadmapIds: string[]) => ({ body: { roadmapIds } }),
});
export const listQuillsRoadmapColumns = byRoadmap();
export const createQuillsRoadmapColumn = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { roadmapId: a.roadmapId },
    body: { statusId: a.freeStatusId, name: "Next", color: "#f97316" },
  }),
  foreign: ({ b }: Ids) => ({
    roadmapId: b.roadmapId,
    statusId: b.freeStatusId,
  }),
  softDelete,
});
export const updateQuillsRoadmapColumn = byColumn({ name: "Now" });
export const deleteQuillsRoadmapColumn = byColumn();
export const listQuillsRoadmapPosts = byRoadmap();
