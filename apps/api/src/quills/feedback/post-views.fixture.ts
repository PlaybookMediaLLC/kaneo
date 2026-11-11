import { postViews } from "../../database/quills/schema/post-views";
import { fixture, type ContractEnv } from "../framework/contract";
import { softDeletes } from "./seeds.fixture";

/** A shared view in one workspace, by its owner or by `userId`. */
const viewIn = async (env: ContractEnv, workspaceId: string, userId?: string) =>
  (
    await env.scoped(
      workspaceId,
      (db, actor) =>
        db
          .insert(postViews)
          .values({
            name: "Contract",
            filters: { sort: "votes" },
            createdByPrincipalId: actor.principalId,
          })
          .returning({ id: postViews.id }),
      userId,
    )
  )[0]!.id;

export const listQuillsPostViews = fixture({
  seed: async (env) => ({
    a: await viewIn(env, env.a),
    b: await viewIn(env, env.b),
  }),
  valid: () => ({}),
});
export const createQuillsPostView = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: { name: "Top requests", filters: { sort: "votes", minVotes: 5 } },
  }),
});
// The caller's own view: the declared update action deletes it. own-records.test.ts covers another teammate's.
export const deleteQuillsPostView = fixture({
  seed: async (env, caller) => ({
    a: await viewIn(env, env.a, caller),
    b: await viewIn(env, env.b),
  }),
  valid: (ids) => ({ params: { viewId: ids.a } }),
  foreign: (ids) => ({ viewId: ids.b }),
  softDelete: softDeletes("post_views", (ids: { a: string }) => ids.a),
});
