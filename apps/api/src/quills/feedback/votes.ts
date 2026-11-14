import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import type { TypeId } from "@kaneo/ids";
import {
  apiRouter,
  pagingNumber,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { posts, postVotes } from "../../database/quills/schema/posts";
import {
  defineQuillsRoute,
  type Database,
  type QuillsActor,
} from "../framework/define-route";
import { recordActivity } from "./activity";
import { lockMergeTarget } from "./thread-counts";
import {
  findPost,
  loadProjects,
  notFound,
  notTest,
  relatedPosts,
} from "./visibility";

const postParams = z.object({ postId: flexibleToTypeIdSchema("post") });
const voterParams = postParams.extend({
  principalId: flexibleToTypeIdSchema("principal"),
});
const voteResult = z.object({
  /** The post that holds the vote: the requested post, or the post it was merged into. */
  postId: z.string(),
  changed: z.boolean(),
  voteCount: z.number(),
});
const errors = { 404: "Post or voter not found" };

/** A vote on a merged post counts on the post it was merged into, as in the source. */
async function votedPost(
  db: Database,
  postId: TypeId<"post">,
  projects: string[],
) {
  const post = await findPost(db, postId, projects);
  return post.canonicalPostId
    ? findPost(db, post.canonicalPostId, projects)
    : post;
}

/**
 * Moves the stored count with the vote row, in the same transaction.
 * A test customer's vote is kept but not counted.
 */
async function count(
  db: Database,
  postId: TypeId<"post">,
  voter: TypeId<"principal">,
  delta?: 1 | -1,
) {
  const [moved] = delta
    ? await db
        .update(posts)
        .set({ voteCount: sql`greatest(0, ${posts.voteCount} + ${delta})` })
        .where(and(eq(posts.id, postId), notTest(voter)))
        .returning({ voteCount: posts.voteCount })
    : [];
  if (moved) return moved.voteCount;
  const [row] = await db
    .select({ voteCount: posts.voteCount })
    .from(posts)
    .where(eq(posts.id, postId));
  return row!.voteCount;
}

/** Adds `voter`'s vote to a visible post, or to the post it was merged into. Idempotent. */
export async function addVote(
  db: Database,
  postId: TypeId<"post">,
  projects: string[],
  voter: TypeId<"principal">,
  addedBy?: QuillsActor,
) {
  // The merge link cannot change while the vote moves a count (thread-counts.ts).
  await lockMergeTarget(db, postId);
  const post = await votedPost(db, postId, projects);
  const [existing] = await db
    .select({ id: postVotes.id })
    .from(postVotes)
    .where(
      and(
        eq(postVotes.principalId, voter),
        inArray(postVotes.postId, relatedPosts(db, post.id)),
      ),
    )
    .limit(1);
  // The unique (post, principal) index decides between two parallel votes.
  const inserted = existing
    ? []
    : await db
        .insert(postVotes)
        .values({
          postId: post.id,
          principalId: voter,
          ...(addedBy && {
            sourceType: "proxy",
            addedByPrincipalId: addedBy.principalId,
          }),
        })
        .onConflictDoNothing()
        .returning({ id: postVotes.id });
  const changed = inserted.length > 0;
  return {
    postId: post.id,
    changed,
    voteCount: await count(db, post.id, voter, changed ? 1 : undefined),
  };
}

/** A principal of this workspace that is not a service account. 404 otherwise. */
async function findVoter(db: Database, id: TypeId<"principal">) {
  const [voter] = await db
    .select({ id: principal.id, name: principal.displayName })
    .from(principal)
    .where(and(eq(principal.id, id), ne(principal.type, "service")))
    .limit(1);
  if (!voter) throw notFound("Voter");
  return voter;
}

const voteEvent =
  (type: "post.voted" | "post.unvoted", proxy: boolean) =>
  (
    { params }: { params: { postId: string; principalId?: string } },
    result: z.output<typeof voteResult>,
  ) =>
    result.changed && {
      type,
      entityType: "post" as const,
      entityId: result.postId,
      payload: proxy ? { principalId: params.principalId! } : undefined,
    };

const listVoters = defineQuillsRoute({
  method: "get",
  path: "/posts/{postId}/voters",
  operationId: "listQuillsPostVoters",
  summary: "List a post's voters, newest first",
  description:
    "The votes the post's count is made of: for a merged post, those of the post it was merged into. Leaves out test customers and votes on posts the caller cannot see. Names come from the principal profile; emails are not returned. importance is how much the voter needs the post, when the voter said so.",
  action: "read",
  params: postParams,
  query: z.object({
    offset: pagingNumber(0, 1000000, 0),
    limit: pagingNumber(1, 100, 50),
  }),
  response: z.object({
    items: z.array(
      z.object({
        principalId: z.string(),
        displayName: z.string().nullable(),
        avatarUrl: z.string().nullable(),
        isAnonymous: z.boolean(),
        sourceType: z.string().nullable(),
        addedByPrincipalId: z.string().nullable(),
        importance: z.enum(postVotes.importance.enumValues).nullable(),
        createdAt: responseTimestamp,
      }),
    ),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "Voters",
  errors,
  load: loadProjects,
  handler: async ({ db, params, query, loaded: projects }) => {
    const post = await findPost(db, params.postId, projects);
    const rows = await db
      .select({
        principalId: principal.id,
        displayName: principal.displayName,
        avatarUrl: principal.avatarUrl,
        type: principal.type,
        sourceType: postVotes.sourceType,
        addedByPrincipalId: postVotes.addedByPrincipalId,
        importance: postVotes.importance,
        createdAt: postVotes.createdAt,
      })
      .from(postVotes)
      .innerJoin(principal, eq(principal.id, postVotes.principalId))
      .where(
        and(
          inArray(
            postVotes.postId,
            relatedPosts(db, post.canonicalPostId ?? post.id, projects),
          ),
          notTest(postVotes.principalId),
        ),
      )
      .orderBy(desc(postVotes.createdAt), desc(postVotes.id))
      .offset(query.offset)
      .limit(query.limit + 1);
    return {
      items: rows.slice(0, query.limit).map(({ type, ...row }) => {
        const isAnonymous = type === "anonymous";
        return {
          ...row,
          isAnonymous,
          displayName: isAnonymous ? null : row.displayName,
          avatarUrl: isAnonymous ? null : row.avatarUrl,
        };
      }),
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
    };
  },
});

const vote = defineQuillsRoute({
  method: "put",
  path: "/posts/{postId}/vote",
  operationId: "voteQuillsPost",
  summary: "Add the caller's vote to a post",
  description:
    "Idempotent. `changed` is false when the caller had already voted.",
  action: "update",
  params: postParams,
  response: voteResult,
  responseDescription: "Vote result",
  errors,
  event: voteEvent("post.voted", false),
  load: loadProjects,
  handler: ({ db, actor, params, loaded: projects }) =>
    addVote(db, params.postId, projects, actor.principalId),
});

const proxyVote = defineQuillsRoute({
  method: "put",
  path: "/posts/{postId}/voters/{principalId}",
  operationId: "addQuillsPostProxyVote",
  summary: "Vote on a post on behalf of a person",
  description:
    "Idempotent. The vote records the caller as the teammate who added it.",
  action: "update",
  params: voterParams,
  response: voteResult,
  responseDescription: "Vote result",
  errors,
  event: voteEvent("post.voted", true),
  load: loadProjects,
  handler: async ({ db, actor, params, loaded: projects }) => {
    const voter = await findVoter(db, params.principalId);
    const result = await addVote(db, params.postId, projects, voter.id, actor);
    if (result.changed)
      await recordActivity(db, actor, result.postId, {
        type: "vote.proxy",
        metadata: { voterPrincipalId: voter.id, voterName: voter.name },
      });
    return result;
  },
});

const removeVote = defineQuillsRoute({
  method: "delete",
  path: "/posts/{postId}/voters/{principalId}",
  operationId: "removeQuillsPostVote",
  summary: "Remove a person's vote from a post",
  description:
    "Idempotent. Use the caller's own principal ID to remove the caller's vote.",
  action: "update",
  params: voterParams,
  response: voteResult,
  responseDescription: "Vote result",
  errors,
  event: voteEvent("post.unvoted", true),
  load: loadProjects,
  handler: async ({ db, actor, params, loaded: projects }) => {
    const voter = await findVoter(db, params.principalId);
    await lockMergeTarget(db, params.postId);
    const post = await votedPost(db, params.postId, projects);
    const removed = await db
      .delete(postVotes)
      .where(
        and(
          eq(postVotes.principalId, voter.id),
          inArray(postVotes.postId, relatedPosts(db, post.id)),
        ),
      )
      .returning({ id: postVotes.id });
    const changed = removed.length > 0;
    if (changed)
      await recordActivity(db, actor, post.id, {
        type: "vote.removed",
        metadata: { voterPrincipalId: voter.id, voterName: voter.name },
      });
    return {
      postId: post.id,
      changed,
      voteCount: await count(db, post.id, voter.id, changed ? -1 : undefined),
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listVoters)
  .openapi(...vote)
  .openapi(...proxyVote)
  .openapi(...removeVote);
