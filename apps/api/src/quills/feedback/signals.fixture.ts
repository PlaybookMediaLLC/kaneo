import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { feedbackSignals } from "../../database/quills/schema/feedback-signals";
import { fixture, type ContractEnv } from "../framework/contract";
import { side } from "./seed.fixture";

/** The feedback rows of one workspace and a signal from a closed conversation of its customer. */
async function signalSide(
  env: ContractEnv,
  workspaceId: string,
  status: "pending" | "dismissed" = "pending",
) {
  const ids = await side(env, workspaceId);
  return env.scoped(workspaceId, async (db) => {
    const [conversation] = await db
      .insert(conversations)
      .values({
        visitorPrincipalId: ids.customerId,
        channel: "messenger",
        status: "closed",
      })
      .returning({ id: conversations.id });
    const [message] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conversation!.id,
        principalId: ids.customerId,
        senderType: "visitor",
        content: "Please add a dark mode",
      })
      .returning({ id: conversationMessages.id });
    const [signal] = await db
      .insert(feedbackSignals)
      .values({
        conversationId: conversation!.id,
        sourceMessageId: message!.id,
        principalId: ids.customerId,
        excerpt: "Please add a dark mode",
        suggestedTitle: "Dark mode",
        matchedPostId: ids.postId,
        status,
        decidedAt: status === "pending" ? null : new Date(),
      })
      .returning({ id: feedbackSignals.id });
    return {
      ...ids,
      conversationId: conversation!.id,
      messageId: message!.id,
      signalId: signal!.id,
    };
  });
}

const seedSignals =
  (status?: "pending" | "dismissed") => async (env: ContractEnv) => ({
    a: await signalSide(env, env.a, status),
    b: await signalSide(env, env.b, status),
  });
type Ids = Awaited<ReturnType<ReturnType<typeof seedSignals>>>;

/** A decision on A's signal. `body` names the body IDs, each with its workspace B value. */
const onSignal = (
  status?: "dismissed",
  body?: (side: Ids["a"]) => Record<string, string>,
) =>
  fixture({
    seed: seedSignals(status),
    valid: ({ a }: Ids) => ({
      params: { signalId: a.signalId },
      ...(body && { body: body(a) }),
    }),
    foreign: ({ b }: Ids) => {
      const { title: _, ...ids } = body?.(b) ?? {};
      return { signalId: b.signalId, ...ids };
    },
  });

export const listQuillsFeedbackSignals = fixture({
  seed: seedSignals(),
  valid: () => ({ query: { status: "pending" } }),
});
export const acceptQuillsFeedbackSignalAsPost = onSignal(undefined, (side) => ({
  boardId: side.boardId,
  title: "Dark mode",
}));
export const acceptQuillsFeedbackSignalAsVote = onSignal(undefined, (side) => ({
  postId: side.postId,
}));
export const dismissQuillsFeedbackSignal = onSignal();
export const restoreQuillsFeedbackSignal = onSignal("dismissed");
