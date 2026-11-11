import { fixture } from "../framework/contract";
import { privatePortal } from "./seed.fixture";

// The decision is not owned data, so `own` is empty on purpose.

export const evaluateQuillsMyPortalAccess = fixture({
  seed: async (env) => {
    const domain = `${env.id("domain")}.example`;
    await privatePortal(env, domain);
    return { domain };
  },
  valid: () => ({}),
  hidden: (ids) => [ids.domain],
  own: () => [],
});

export const recordQuillsPortalAccessDenied = fixture({
  seed: async (env) => {
    const domain = `${env.id("domain")}.example`;
    await privatePortal(env, domain);
    return { domain };
  },
  valid: () => ({}),
  hidden: (ids) => [ids.domain],
  own: () => [],
});
