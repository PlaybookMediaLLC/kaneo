import { fixture } from "../framework/contract";
import { enableWidget } from "./seed.fixture";

export const getQuillsWidgetConfig = fixture({
  seed: async (env) => ({
    a: await enableWidget(env, env.a),
    b: await enableWidget(env, env.b),
  }),
  valid: () => ({}),
  hidden: (ids) => [ids.a, ids.b],
});

// These two read no workspace data, so nothing is hidden.
export const getQuillsWidgetCapabilities = fixture({
  seed: async () => ({}),
  valid: () => ({}),
  hidden: () => [],
});

export const getQuillsWidgetLocale = fixture({
  seed: async () => ({}),
  valid: () => ({ query: { locale: "fr-CA" } }),
  hidden: () => [],
});
