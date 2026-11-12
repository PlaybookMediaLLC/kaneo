import { fixture } from "../framework/contract";
import { seed } from "../support/conversation-seed.fixture";

// The seeded conversation's subject is "Support contract".
export const searchQuillsWorkspace = fixture({
  seed,
  valid: () => ({ query: { q: "contract" } }),
});
