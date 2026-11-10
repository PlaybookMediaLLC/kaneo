import { fixture } from "../framework/contract";
import "./provider-edge.fixture";
import "./seed.fixture";

export const saveQuillsStripeKey = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { apiKey: "rk_test_contract" } }),
});
