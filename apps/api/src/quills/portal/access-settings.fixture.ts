import { fixture } from "../framework/contract";

export const updateQuillsPortalAccess = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: { visibility: "private", allowedDomains: ["@Example.COM", "bad"] },
  }),
});
