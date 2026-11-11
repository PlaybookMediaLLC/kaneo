import { empty, fixture } from "../framework/contract";

export const listQuillsPrincipals = empty;
export const listQuillsMentionSuggestions = empty;
export const getQuillsPrincipal = fixture({
  // The owner of each workspace is a current member with a Quills actor.
  seed: async (env) => ({
    a: await env.scoped(env.a, async (_db, actor) => actor.principalId),
    b: await env.scoped(env.b, async (_db, actor) => actor.principalId),
  }),
  valid: ({ a }) => ({ params: { principalId: a } }),
  foreign: ({ b }) => ({ principalId: b }),
});
