import { isNull } from "drizzle-orm";
import { postStatuses } from "../../database/quills/schema/statuses";
import { fixture, type ContractEnv } from "../framework/contract";
import { oauthConnection, platformCredentials } from "./oauth-seed.fixture";

const enabled = {
  webhookSecret: "contract-webhook-secret",
  config: { statusSync: { target: "acme:app", hookId: "1", state: "active" } },
};
const seed =
  (extra: Parameters<typeof oauthConnection>[2] = {}) =>
  async (env: ContractEnv) => {
    await platformCredentials(env, env.a);
    const [status] = await env.scoped(env.a, (db) =>
      db
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .where(isNull(postStatuses.deletedAt))
        .limit(1),
    );
    return {
      a: await oauthConnection(env, env.a, extra),
      b: await oauthConnection(env, env.b, extra),
      statusId: status!.id,
    };
  };
type Ids = Awaited<ReturnType<ReturnType<typeof seed>>>;
const one = (body?: (ids: Ids) => object, extra?: Parameters<typeof seed>[0]) =>
  fixture({
    seed: seed(extra),
    valid: (ids: Ids) => ({
      params: { integrationId: ids.a },
      body: body?.(ids),
    }),
    foreign: ({ b }: Ids) => ({ integrationId: b }),
    hidden: () => ["contract-webhook-secret", "gho_seeded_"],
  });

export const getQuillsStatusSync = one(undefined, enabled);
export const enableQuillsStatusSync = one(() => ({ target: "acme:app" }));
export const disableQuillsStatusSync = one(undefined, enabled);
export const updateQuillsStatusMappings = one((ids) => ({
  mappings: { Closed: ids.statusId, Open: null },
}));
