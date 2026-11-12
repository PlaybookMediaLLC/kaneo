import { fixture } from "../framework/contract";
import "./seed.fixture";

export const saveQuillsSegmentConnection = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { incomingSecret: "segment-contract-secret" } }),
  hidden: () => ["segment-contract-secret"],
});
