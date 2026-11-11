import { fixture } from "../framework/contract";
import { privatePortal } from "./seed.fixture";

export const getQuillsPublicPortalConfig = fixture({
  seed: async (env) => {
    const domain = `${env.id("domain")}.example`;
    await privatePortal(env, domain);
    return { domain, b: env.b };
  },
  valid: () => ({}),
  hidden: (ids) => [ids.domain, ids.b],
});
