import { eq } from "drizzle-orm";
import { user as customer } from "../../database/quills/schema/auth";
import { fixture, type ContractEnv } from "../framework/contract";
import { enablePortal } from "./customer-seed.fixture";

/** The portal on in A and customer A's profile with a language only customer A may read. */
async function languageOf(env: ContractEnv) {
  await enablePortal(env, env.a);
  const ids = await env.portalCustomer(env.a, env.customerA);
  await env.scoped(env.a, (db) =>
    db
      .update(customer)
      .set({ preferredLanguage: "pt-BR" })
      .where(
        eq(customer.id, ids.customerId as typeof customer.$inferSelect.id),
      ),
  );
  return ids;
}
const probe = (env: ContractEnv) =>
  env.scoped(env.a, (db) =>
    db
      .select({ language: customer.preferredLanguage })
      .from(customer)
      .where(eq(customer.kaneoUserId, env.customerA)),
  );

export const getQuillsMyLanguagePreference = fixture({
  seed: languageOf,
  valid: () => ({}),
  own: () => ["pt-BR"],
});

export const setQuillsMyLanguagePreference = fixture({
  seed: languageOf,
  valid: () => ({ body: { language: "de" } }),
  own: () => ["pt-BR"],
  probe,
});

export const listQuillsPortalMentionSuggestions = fixture({
  seed: async (env) => {
    await enablePortal(env, env.a);
    return env.portalCustomer(env.a, env.customerA);
  },
  valid: () => ({ query: { q: "" } }),
  own: () => [],
});
