import { empty, fixture } from "../../framework/contract";

export const getQuillsStatusSettings = empty;
export const updateQuillsStatusSettings = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { pageDescription: "All systems", enabled: true } }),
});
