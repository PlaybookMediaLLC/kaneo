import { createRun } from "../assistant/runs";
import { fixture } from "../framework/contract";
import { enableWidget } from "./seed.fixture";

export const createQuillsWidgetKbAsk = fixture({
  seed: async (env) => {
    await enableWidget(env, env.a);
    return { visitor: await env.widgetVisitor(env.a) };
  },
  valid: ({ visitor }) => ({
    bearer: visitor.token,
    body: { question: "How do refunds work?" },
  }),
});

/** A run of a widget visitor in A, and one of B's owner. */
export const getQuillsWidgetKbAsk = fixture({
  seed: async (env) => {
    await enableWidget(env, env.a);
    const visitor = await env.widgetVisitor(env.a);
    const run = (workspaceId: string, principalId?: string) =>
      env.scoped(
        workspaceId,
        async (db, actor) =>
          (
            await createRun(db, principalId ?? actor.principalId, "kb_ask", {
              question: "Refunds?",
            })
          ).id,
      );
    return {
      visitor,
      a: await run(env.a, visitor.principalId),
      b: await run(env.b),
    };
  },
  valid: ({ visitor, a }) => ({ bearer: visitor.token, params: { runId: a } }),
  foreign: ({ b }) => ({ runId: b }),
  hidden: ({ b }) => [b],
});
