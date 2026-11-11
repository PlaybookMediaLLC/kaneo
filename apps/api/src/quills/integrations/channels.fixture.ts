import { fixture, type ContractEnv } from "../framework/contract";
import { channel } from "./seed.fixture";

const seed = async (env: ContractEnv) => ({
  a: await channel(env, env.a),
  b: await channel(env, env.b),
});
type Ids = Awaited<ReturnType<typeof seed>>;

export const addQuillsNotificationChannel = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { integrationId: a.integrationId },
    body: { channel: "group-new", events: ["post.created"] },
  }),
  foreign: ({ b }: Ids) => ({ integrationId: b.integrationId }),
});
export const updateQuillsNotificationChannel = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: a,
    body: { events: [{ eventType: "post.created", enabled: false }] },
  }),
  foreign: ({ b }: Ids) => b,
});
export const removeQuillsNotificationChannel = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: a }),
  foreign: ({ b }: Ids) => b,
});
