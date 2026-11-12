import { customers } from "../directory/seed.fixture";
import { fixture, type ContractEnv } from "../framework/contract";
import "./contacts.fixture";
import { oauthConnection } from "./oauth-seed.fixture";

/** A customer in each workspace, and a HubSpot connection in each, so the read calls a provider. */
const seed = async (env: ContractEnv) => {
  await oauthConnection(env, env.a, { type: "hubspot" });
  await oauthConnection(env, env.b, { type: "hubspot" });
  return customers(env);
};
type People = Awaited<ReturnType<typeof seed>>;

export const getQuillsCustomerContext = fixture({
  seed,
  valid: ({ a }: People) => ({ params: { principalId: a } }),
  foreign: ({ b }: People) => ({ principalId: b }),
});
