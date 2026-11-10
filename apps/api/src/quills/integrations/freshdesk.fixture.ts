import { fixture } from "../framework/contract";
import "./provider-edge.fixture";
import "./seed.fixture";

export const saveQuillsFreshdeskKey = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { apiKey: "contract-key", subdomain: "contract" } }),
});
