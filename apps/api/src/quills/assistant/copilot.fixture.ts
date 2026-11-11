import { fixture } from "../framework/contract";
import { on, runOf } from "./seed.fixture";

export const createQuillsAdminAssistantCopilot = on(
  ["conversation"],
  (a) => ({
    body: { conversationId: a.conversationId, question: "What happened?" },
  }),
  (b) => ({ conversationId: b.conversationId }),
);
/** A run of the calling teammate in A, and one of B's owner. */
export const getQuillsAssistantRun = fixture({
  seed: async (env, caller) => ({
    a: await runOf(env, env.a, caller),
    b: await runOf(env, env.b),
  }),
  valid: ({ a }) => ({ params: { runId: a } }),
  foreign: ({ b }) => ({ runId: b }),
});
export const createQuillsAdminAssistantTransform = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { kind: "more_formal", text: "hey, fixed it" } }),
});
export const recordQuillsCopilotEvent = on(
  ["conversation"],
  (a) => ({
    body: {
      conversationId: a.conversationId,
      eventType: "answer_inserted",
      destination: "reply",
    },
  }),
  (b) => ({ conversationId: b.conversationId }),
);
