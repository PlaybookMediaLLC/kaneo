import { fixture } from "../framework/contract";
import { side } from "../feedback/seed.fixture";

// A post in the default status in A, so the review list has a row.
export const fetchQuillsAdminOverview = fixture({
  seed: (env) => side(env, env.a),
  valid: () => ({}),
});
