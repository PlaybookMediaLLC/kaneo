import { and, isNull, like } from "drizzle-orm";
import { postStatuses } from "../../database/quills/schema/statuses";
import { fixture, type ContractEnv } from "../framework/contract";
import { statusIn } from "./seeds.fixture";

const seed = async (env: ContractEnv) => ({
  a: await statusIn(env, env.a),
  b: await statusIn(env, env.b),
});
type Ids = Awaited<ReturnType<typeof seed>>;
const byId = (body?: object) =>
  fixture({
    seed,
    valid: ({ a }: Ids) => ({ params: { statusId: a }, body }),
    foreign: ({ b }: Ids) => ({ statusId: b }),
  });

export const listQuillsStatuses = fixture({ seed, valid: () => ({}) });
export const getQuillsStatus = byId();
export const createQuillsStatus = fixture({
  seed: async (env) => env.id("status"),
  valid: (slug: string) => ({
    body: { name: "Shipped", slug, color: "#22c55e", category: "complete" },
  }),
});
export const updateQuillsStatus = byId({
  name: "Renamed",
  showOnRoadmap: true,
});
export const deleteQuillsStatus = byId();
export const reorderQuillsStatuses = fixture({
  // Retire earlier fixture statuses, so the full list stays short; the defaults stay.
  seed: async (env) => {
    await env.scoped(env.a, (db) =>
      db
        .update(postStatuses)
        .set({ deletedAt: new Date() })
        .where(
          and(
            like(postStatuses.slug, `${env.id("x").split("_x_")[0]}%`),
            isNull(postStatuses.deletedAt),
          ),
        ),
    );
    await statusIn(env, env.a);
    await statusIn(env, env.a);
    const rows = await env.scoped(env.a, (db) =>
      db
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .where(isNull(postStatuses.deletedAt)),
    );
    return rows.map((row) => row.id).reverse();
  },
  valid: (statusIds: string[]) => ({ body: { statusIds } }),
});
