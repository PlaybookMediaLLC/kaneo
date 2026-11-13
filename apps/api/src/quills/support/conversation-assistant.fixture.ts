import { assistantInvolvements } from "../../database/quills/schema/assistant";
import { fixture, type ContractEnv } from "../framework/contract";
import {
  all,
  onConversation,
  seed,
  type Ids,
} from "./conversation-seed.fixture";

/** The conversations of A and B, each with a handed-off involvement that cites an article. */
const withInvolvement = async (env: ContractEnv, caller: string) => {
  const ids = await seed(env, caller);
  for (const [workspaceId, side] of [
    [env.a, ids.a],
    [env.b, ids.b],
  ] as const)
    await env.scoped(workspaceId, (db) =>
      db.insert(assistantInvolvements).values({
        conversationId: side.conversationId,
        triggeredBy: "first_touch",
        status: "handed_off",
        handoffReason: "explicit_request",
        sources: [
          { type: "article", id: "article", title: "Guide", url: "/guide" },
        ],
      }),
    );
  return ids;
};

export const startQuillsAgentConversation = fixture({
  seed,
  valid: (ids: Ids) => ({
    body: { targetPrincipalId: ids.a.visitorId, content: "Hello from us" },
  }),
  foreign: (ids: Ids) => ({ targetPrincipalId: ids.b.visitorId }),
});
export const fetchQuillsAssistantInboxCounts = fixture({
  ...all,
  seed: withInvolvement,
});
export const getQuillsConversationAssistantActivity = {
  ...onConversation(),
  seed: withInvolvement,
};
