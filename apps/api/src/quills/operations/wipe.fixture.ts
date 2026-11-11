import { fixture } from "../framework/contract";

// The contract never runs the worker, so the queued wipe never deletes workspace A's fixtures.
export const wipeQuillsWorkspaceData = fixture({
  // The contract seeds each workspace with its ID as the slug.
  seed: async (env) => ({ slug: env.a }),
  valid: ({ slug }) => ({ body: { confirm: slug } }),
});
