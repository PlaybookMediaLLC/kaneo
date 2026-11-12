import { fixture, type ContractEnv } from "../framework/contract";
import { company, customer, member, segment } from "../directory/seed.fixture";
import { world } from "./feedback/seed.fixture";

/**
 * Customer A's profile in A, with a visible post, a visible comment and a held post (`own`: only
 * customer A sees it). Workspace B has the same rows for customer A's profile there.
 */
export const getQuillsPublicUserProfile = fixture({
  seed: async (env: ContractEnv) => {
    const me = await env.portalCustomer(env.a, env.customerA);
    const foreign = await env.portalCustomer(env.b, env.customerA);
    return {
      me: me.principalId,
      foreign: foreign.principalId,
      a: await world(env, env.a, me.principalId),
      b: await world(env, env.b, foreign.principalId),
    };
  },
  valid: (s) => ({ params: { principalId: s.me } }),
  foreign: (s) => ({ principalId: s.foreign }),
  hidden: (s) => [...s.a.hidden, ...s.b.hidden, s.b.postTitle, s.b.postId],
  own: (s) => s.a.own,
});

/** A customer with an email, a company and a segment in one workspace. */
async function person(env: ContractEnv, workspaceId: string) {
  const companyId = await company(env, workspaceId);
  const principalId = await customer(env, workspaceId, { companyId });
  await member(env, workspaceId, await segment(env, workspaceId), principalId);
  return principalId;
}

export const getQuillsProfileTeamContext = fixture({
  seed: async (env: ContractEnv) => ({
    a: await person(env, env.a),
    b: await person(env, env.b),
  }),
  valid: (s) => ({ params: { principalId: s.a } }),
  foreign: (s) => ({ principalId: s.b }),
});
