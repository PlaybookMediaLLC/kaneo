import { fixture, type ContractEnv } from "../framework/contract";
import { operation } from "./seed.fixture";

const seed = async (env: ContractEnv) => ({
  a: await operation(env, env.a),
  b: await operation(env, env.b),
});
type Ids = Awaited<ReturnType<typeof seed>>;

export const listQuillsIntegrationSyncHistory = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { integrationId: a.integrationId } }),
  foreign: ({ b }: Ids) => ({ integrationId: b.integrationId }),
});
export const inspectQuillsIntegrationSync = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { syncId: a.syncId } }),
  foreign: ({ b }: Ids) => ({ syncId: b.syncId }),
});
export const recoverQuillsIntegrationSync = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { syncId: a.syncId },
    body: { action: "retry", version: a.version, idempotencyKey: a.key },
  }),
  foreign: ({ b }: Ids) => ({ syncId: b.syncId }),
});
