import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { postVotes, posts } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { fixture, type ContractEnv } from "../framework/contract";

/** A post on an unlinked board and a customer who voted on it. */
async function side(env: ContractEnv, workspaceId: string) {
  return env.scoped(workspaceId, async (db, actor) => {
    const [board] = await db
      .insert(boards)
      .values({ name: "Contract", slug: env.id("board") })
      .returning({ id: boards.id });
    const [status] = await db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .limit(1);
    const [post] = await db
      .insert(posts)
      .values({
        title: "Contract",
        content: "Contract",
        boardId: board!.id,
        principalId: actor.principalId,
        statusId: status!.id,
      })
      .returning({ id: posts.id });
    const [voter] = await db
      .insert(principal)
      .values({ displayName: "Voter", createdAt: new Date() })
      .returning({ id: principal.id });
    await db
      .insert(postVotes)
      .values({ postId: post!.id, principalId: voter!.id });
    return { postId: post!.id, voterId: voter!.id };
  });
}
const seed = async (env: ContractEnv) => ({
  a: await side(env, env.a),
  b: await side(env, env.b),
});
type Ids = Awaited<ReturnType<typeof seed>>;
const own = (body?: object) =>
  fixture({
    seed,
    valid: ({ a }: Ids) => ({ params: { postId: a.postId }, body }),
    foreign: ({ b }: Ids) => ({ postId: b.postId }),
  });

export const getQuillsPostSubscription = own();
export const setQuillsPostSubscription = own({ level: "all" });
export const deleteQuillsPostSubscription = own();
export const setQuillsVoterSubscription = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    params: { postId: a.postId, principalId: a.voterId },
    body: { level: "status_only" },
  }),
  foreign: ({ b }: Ids) => ({ postId: b.postId, principalId: b.voterId }),
});
