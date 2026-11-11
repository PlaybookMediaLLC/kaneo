import { fixture, type ContractEnv } from "../framework/contract";
import { customer } from "./seed.fixture";

const pair = async (env: ContractEnv, workspaceId: string) => ({
  lead: await customer(env, workspaceId, { lead: true }),
  target: await customer(env, workspaceId),
});

export const mergeQuillsLeadIntoUser = fixture({
  seed: async (env) => ({
    a: await pair(env, env.a),
    b: await pair(env, env.b),
  }),
  valid: ({ a }) => ({
    params: { principalId: a.lead },
    body: { targetPrincipalId: a.target },
  }),
  foreign: ({ b }) => ({ principalId: b.lead, targetPrincipalId: b.target }),
});
