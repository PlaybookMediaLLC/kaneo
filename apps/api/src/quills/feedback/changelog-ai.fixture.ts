import {
  chatReply,
  EMBEDDING,
  provider,
  type ProviderRequest,
} from "../assistant/provider-edge.fixture";
import { fixture } from "../framework/contract";
import { postIn } from "./seeds.fixture";

/** Answers a changelog draft prompt with a draft, and every other call as the default edge does. */
const draftReply = (request: ProviderRequest) =>
  request.path.endsWith("/embeddings")
    ? {
        json: {
          data: (request.body.input as string[]).map((_, index) => ({
            index,
            embedding: EMBEDDING,
          })),
          usage: { prompt_tokens: 4, total_tokens: 4 },
        },
      }
    : JSON.stringify(request.body.messages).includes("changelog entry")
      ? chatReply({ title: "Contract draft", body: "- Shipped" })
      : chatReply({ text: "Contract answer" });

export const draftQuillsChangelogFromPosts = fixture({
  seed: async (env) => {
    provider.reply(draftReply);
    return {
      a: await postIn(env, env.a),
      b: await postIn(env, env.b),
    };
  },
  valid: ({ a }) => ({ body: { postIds: [a.postId] } }),
});
