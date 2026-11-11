import { empty, fixture } from "../framework/contract";

export const getQuillsPoweredBy = empty;
export const setQuillsPoweredBy = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { showPoweredBy: false } }),
});
