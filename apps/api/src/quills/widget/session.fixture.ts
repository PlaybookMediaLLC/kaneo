import { fixture } from "../framework/contract";

export const getQuillsWidgetSession = fixture({
  seed: (env) => env.widgetVisitor(env.a),
  valid: (ids) => ({ bearer: ids.token }),
});

export const linkQuillsWidgetDevice = fixture({
  seed: async (env) => ({
    ...(await env.widgetVisitor(env.a)),
    device: env.id("device"),
  }),
  valid: (ids) => ({ bearer: ids.token, body: { device: ids.device } }),
});
