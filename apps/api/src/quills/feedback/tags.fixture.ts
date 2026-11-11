import { postTags } from "../../database/quills/schema/boards";
import { fixture, type ContractEnv } from "../framework/contract";

/** A fresh tag in one workspace. */
const tagIn = async (env: ContractEnv, workspaceId: string) =>
  (
    await env.scoped(workspaceId, (db) =>
      db
        .insert(postTags)
        .values({ name: env.id("tag") })
        .returning({ id: postTags.id }),
    )
  )[0]!.id;
const seed = async (env: ContractEnv) => ({
  a: await tagIn(env, env.a),
  b: await tagIn(env, env.b),
});
type Ids = Awaited<ReturnType<typeof seed>>;
const byId = (body?: object) =>
  fixture({
    seed,
    valid: ({ a }: Ids) => ({ params: { tagId: a }, body }),
    foreign: ({ b }: Ids) => ({ tagId: b }),
  });

export const listQuillsTags = fixture({ seed, valid: () => ({}) });
export const getQuillsTag = byId();
export const createQuillsTag = fixture({
  seed: async (env) => env.id("tag"),
  valid: (name: string) => ({ body: { name, color: "#112233" } }),
});
export const updateQuillsTag = fixture({
  seed: async (env) => ({ ...(await seed(env)), name: env.id("renamed") }),
  valid: ({ a, name }) => ({ params: { tagId: a }, body: { name } }),
  foreign: ({ b }) => ({ tagId: b }),
});
export const deleteQuillsTag = byId();
