import { fixture } from "../framework/contract";

// The internal caller's token. A configured value wins.
process.env.QUILLS_INTERNAL_TOKEN ||= "quills-contract-internal-token";

export const wakeQuillsJobs = fixture({
  seed: async () => ({}),
  valid: () => ({
    headers: {
      authorization: `Bearer ${process.env.QUILLS_INTERNAL_TOKEN}`,
    },
  }),
});
