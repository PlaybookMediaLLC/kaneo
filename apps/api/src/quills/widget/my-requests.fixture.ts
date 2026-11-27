import { fixture } from "../framework/contract";
import { enableWidget } from "./seed.fixture";

export const listQuillsWidgetMyRequests = fixture({
  seed: async (env) => {
    await enableWidget(env, env.a);
    const visitor = await env.widgetVisitor(env.a);
    return { token: visitor.token };
  },
  valid: (ids) => ({ bearer: ids.token }),
});
