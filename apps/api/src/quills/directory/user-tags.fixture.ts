import { fixture, type ContractEnv } from "../framework/contract";
import { customer, customers, tag, tagged } from "./seed.fixture";

const side = async (env: ContractEnv, workspaceId: string, assign: boolean) => {
  const principalId = await customer(env, workspaceId);
  const tagId = await tag(env, workspaceId);
  if (assign) await tagged(env, workspaceId, principalId, tagId);
  return { principalId, tagId };
};
const both = (assign: boolean) => async (env: ContractEnv) => ({
  a: await side(env, env.a, assign),
  b: await side(env, env.b, assign),
});
type Both = Awaited<ReturnType<ReturnType<typeof both>>>;

export const listQuillsUserTags = fixture({
  seed: (env) => tag(env, env.a),
  valid: () => ({}),
});

export const listQuillsUserTagsForPrincipal = fixture({
  seed: customers,
  valid: (ids) => ({ params: { principalId: ids.a } }),
  foreign: (ids) => ({ principalId: ids.b }),
});

export const assignQuillsUserTag = fixture({
  seed: both(false),
  valid: ({ a }: Both) => ({
    params: { principalId: a.principalId },
    body: { tagId: a.tagId },
  }),
  foreign: ({ b }: Both) => ({ principalId: b.principalId, tagId: b.tagId }),
});

export const removeQuillsUserTag = fixture({
  seed: both(true),
  valid: ({ a }: Both) => ({ params: a }),
  foreign: ({ b }: Both) => b,
});
