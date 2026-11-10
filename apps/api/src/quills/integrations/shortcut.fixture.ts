import { fixture } from "../framework/contract";
import "./provider-edge.fixture";
import "./seed.fixture";

export const saveQuillsShortcutToken = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { apiToken: "contract-token" } }),
});
