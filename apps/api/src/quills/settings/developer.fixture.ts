import { empty, fixture } from "../framework/contract";

export const getQuillsDeveloperSettings = empty;
export const updateQuillsDeveloperSettings = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { mcpEnabled: false } }),
});
