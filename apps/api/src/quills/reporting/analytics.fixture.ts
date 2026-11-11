import { fixture } from "../framework/contract";
import { side } from "../feedback/seed.fixture";

// Feedback rows in A, so the analytics have data to count. The feature test covers what they leave out.
export const getQuillsAnalyticsData = fixture({
  seed: (env) => side(env, env.a),
  valid: () => ({ query: { period: "30d" } }),
});
