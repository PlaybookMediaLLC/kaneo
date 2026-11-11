import { empty, fixture, type ContractEnv } from "../framework/contract";
import { connection } from "./seed.fixture";

const seed = async (env: ContractEnv) => ({
  a: (await connection(env, env.a)).id,
  b: (await connection(env, env.b)).id,
});
type Ids = Awaited<ReturnType<typeof seed>>;
const one = (body?: object) =>
  fixture({
    seed,
    valid: ({ a }: Ids) => ({ params: { integrationId: a }, body }),
    foreign: ({ b }: Ids) => ({ integrationId: b }),
  });

export const listQuillsIntegrations = fixture({ seed, valid: () => ({}) });
export const listQuillsIntegrationCatalog = empty;
export const getQuillsIntegration = one();
export const updateQuillsIntegration = one({
  enabled: true,
  eventMappings: [{ eventType: "post.created", enabled: true }],
});
export const deleteQuillsIntegration = one();
