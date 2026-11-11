import type { PostId, PrincipalId } from "@kaneo/ids";
import { postSubscriptions } from "../../database/quills/schema/notifications";
import { hashToken } from "../framework/audience";
import { fixture, type ContractEnv } from "../framework/contract";
import { customerPost } from "./customer-seed.fixture";
import { mintUnsubscribeToken } from "./unsubscribe-token";

/** A subscribed principal in one workspace and an unsubscribe link for that post. */
const subscribed = (env: ContractEnv, workspaceId: string) =>
  customerPost(env, workspaceId).then(({ postId, title }) =>
    env.scoped(workspaceId, async (db, actor) => {
      const principalId = actor.principalId as PrincipalId;
      await db.insert(postSubscriptions).values({
        postId: postId as PostId,
        principalId,
        reason: "manual",
      });
      const token = await mintUnsubscribeToken(
        db,
        principalId,
        "unsubscribe_post",
        postId as PostId,
      );
      return { token, principalId, title };
    }),
  );
const seed = async (env: ContractEnv) => ({
  a: await subscribed(env, env.a),
  b: await subscribed(env, env.b),
});
type Ids = Awaited<ReturnType<typeof seed>>;
// No response names the recipient, the stored hash or anything of workspace B.
const hidden = ({ a, b }: Ids) => [
  hashToken(a.token),
  a.principalId,
  b.token,
  b.title,
];

export const previewQuillsUnsubscribeToken = fixture({
  seed,
  valid: ({ a }: Ids) => ({ query: { token: a.token } }),
  hidden,
});
export const createQuillsUnsubscribe = fixture({
  seed,
  valid: ({ a }: Ids) => ({ query: { token: a.token } }),
  hidden,
});
export const processQuillsUnsubscribeToken = fixture({
  seed,
  valid: ({ a }: Ids) => ({ body: { token: a.token } }),
  hidden,
});
