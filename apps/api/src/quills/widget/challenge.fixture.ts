import { fixture } from "../framework/contract";
import { enableWidget } from "./seed.fixture";

export const createQuillsWidgetChallenge = fixture({
  seed: async (env) => ({
    a: await enableWidget(env, env.a),
    b: await enableWidget(env, env.b),
  }),
  valid: () => ({}),
  hidden: (ids) => [ids.a, ids.b],
});
