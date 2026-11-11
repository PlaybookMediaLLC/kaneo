import { empty, fixture } from "../framework/contract";

export const getQuillsFeatureFlagSettings = empty;
export const updateQuillsFeatureFlagSettings = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { statusPage: true } }),
});
