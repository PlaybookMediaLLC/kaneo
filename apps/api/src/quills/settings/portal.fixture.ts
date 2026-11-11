import { empty, fixture } from "../framework/contract";

export const getQuillsPortalSettings = empty;
export const updateQuillsPortalSettings = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { allowAnonymous: true } }),
});
