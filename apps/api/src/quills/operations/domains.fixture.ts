import { customDomains } from "../../database/quills/schema/custom-domains";
import { empty, fixture, type ContractEnv } from "../framework/contract";

/** A fresh, valid host name: contract IDs carry underscores, which host names refuse. */
const freshDomain = (env: ContractEnv) =>
  `${env.id("domain").replaceAll("_", "-")}.example.com`;

/** Gives workspace A a domain of this kind, replacing the one it had. */
const seedDomain =
  (kind: "portal" | "help_center") => async (env: ContractEnv) => {
    const values = {
      domain: freshDomain(env),
      verificationValue: "contract",
      verifiedAt: null,
    };
    await env.scoped(env.a, (db) =>
      db
        .insert(customDomains)
        .values({ kind, ...values })
        .onConflictDoUpdate({
          target: [customDomains.workspaceId, customDomains.kind],
          set: values,
        }),
    );
    return {};
  };

const set = fixture({
  seed: async (env) => ({ domain: freshDomain(env) }),
  valid: ({ domain }) => ({ body: { domain } }),
});

export const listQuillsCustomDomains = empty;
export const setQuillsPortalDomain = set;
export const setQuillsHelpCenterDomain = set;
export const removeQuillsPortalDomain = fixture({
  seed: seedDomain("portal"),
  valid: () => ({}),
});
export const removeQuillsHelpCenterDomain = fixture({
  seed: seedDomain("help_center"),
  valid: () => ({}),
});
export const verifyQuillsPortalDomain = fixture({
  seed: seedDomain("portal"),
  valid: () => ({}),
});
export const verifyQuillsHelpCenterDomain = fixture({
  seed: seedDomain("help_center"),
  valid: () => ({}),
});
