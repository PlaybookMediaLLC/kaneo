import { createId } from "@kaneo/ids";
import { eq } from "drizzle-orm";
import { principal, settings } from "../../../database/quills/schema/auth";
import {
  boards,
  roadmapColumns,
  roadmaps,
} from "../../../database/quills/schema/boards";
import {
  changelogEntries,
  changelogEntryPosts,
} from "../../../database/quills/schema/changelog";
import { postSubscriptions } from "../../../database/quills/schema/notifications";
import { boardProjects } from "../../../database/quills/schema/platform-links";
import {
  postCommentReactions,
  postComments,
  posts,
  postVotes,
} from "../../../database/quills/schema/posts";
import { postStatuses } from "../../../database/quills/schema/statuses";
import { DEFAULT_BOARD_ACCESS } from "../../../database/quills/types";
import { projectTable } from "../../../database/schema";
import type { ContractEnv } from "../../framework/contract";

type Id<T extends { $inferSelect: { id: unknown } }> = T["$inferSelect"]["id"];
const teamOnly = {
  ...DEFAULT_BOARD_ACCESS,
  view: "team",
  vote: "team",
  submit: "team",
  comment: "team",
} as const;

/**
 * Feedback in one workspace with its portal on and anonymous interaction allowed: a public
 * board with a post, a comment and a published changelog entry, and every kind of row that a
 * customer must never see. `me` is the caller's principal: it gets an own post, an own held post
 * and an own comment. `hidden` lists text that no other caller may read; `own` lists text that
 * only `me` may read.
 */
export async function world(
  env: ContractEnv,
  workspaceId: string,
  me?: string,
) {
  const projectId = env.id("project");
  await env.db
    .insert(projectTable)
    .values({ id: projectId, workspaceId, name: "Linked", slug: projectId });
  return env.scoped(workspaceId, async (db, actor) => {
    const hidden: string[] = [];
    const own: string[] = [];
    const label = (list: string[], name: string) => {
      const value = env.id(name);
      list.push(value);
      return value;
    };
    const visible = (name: string) => env.id(name);
    await db.update(settings).set({
      portalConfig: JSON.stringify({
        enabled: true,
        features: { allowAnonymous: true },
      }),
    });
    const [status] = await db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .where(eq(postStatuses.isDefault, true));
    const [pub, priv, linked] = await db
      .insert(boards)
      .values([
        { name: "Public", slug: env.id("pub") },
        {
          name: label(hidden, "private-board"),
          slug: env.id("priv"),
          access: teamOnly,
        },
        { name: label(hidden, "linked-board"), slug: env.id("linked") },
      ])
      .returning({ id: boards.id });
    await db.insert(boardProjects).values({ boardId: linked!.id, projectId });
    // A teammate owns at most one test customer.
    const [tester] = await db
      .select({ id: principal.id })
      .from(principal)
      .where(eq(principal.testOwnerPrincipalId, actor.principalId));
    const testerId =
      tester?.id ??
      (
        await db
          .insert(principal)
          .values({
            type: "user",
            role: "user",
            displayName: "Tester",
            createdAt: new Date(),
            testOwnerPrincipalId: actor.principalId,
          })
          .returning({ id: principal.id })
      )[0]!.id;
    const [other] = await db
      .insert(principal)
      .values({
        type: "user",
        role: "user",
        displayName: "Other",
        createdAt: new Date(),
      })
      .returning({ id: principal.id });
    const caller = me as Id<typeof principal> | undefined;
    const post = async (
      values: Partial<typeof posts.$inferInsert> & { title: string },
    ) =>
      (
        await db
          .insert(posts)
          .values({
            boardId: pub!.id,
            content: "Body",
            principalId: actor.principalId,
            statusId: status!.id,
            ...values,
          })
          .returning({ id: posts.id })
      )[0]!.id;
    const postId = await post({ title: visible("post") });
    await post({ title: label(hidden, "private-post"), boardId: priv!.id });
    await post({ title: label(hidden, "linked-post"), boardId: linked!.id });
    await post({ title: label(hidden, "deleted-post"), deletedAt: new Date() });
    await post({ title: label(hidden, "test-post"), principalId: testerId });
    await post({
      title: label(hidden, "held-post"),
      principalId: other!.id,
      moderationState: "pending",
    });
    const ownPost = caller
      ? await post({ title: visible("own-post"), principalId: caller })
      : undefined;
    if (caller)
      await post({
        title: label(own, "own-held-post"),
        principalId: caller,
        moderationState: "pending",
      });
    const comment = async (
      values: Partial<typeof postComments.$inferInsert> & { content: string },
    ) =>
      (
        await db
          .insert(postComments)
          .values({ postId, principalId: other!.id, ...values })
          .returning({ id: postComments.id })
      )[0]!.id;
    const commentId = await comment({ content: visible("comment") });
    await comment({
      content: label(hidden, "private-comment"),
      principalId: actor.principalId,
      isPrivate: true,
      isTeamMember: true,
    });
    await comment({
      content: label(hidden, "held-comment"),
      moderationState: "pending",
    });
    await comment({
      content: label(hidden, "test-comment"),
      principalId: testerId,
    });
    const ownComment = caller
      ? await comment({ content: visible("own-comment"), principalId: caller })
      : undefined;
    const day = 24 * 60 * 60 * 1000;
    const [entry] = await db
      .insert(changelogEntries)
      .values([
        {
          title: visible("entry"),
          content: "Shipped",
          publishedAt: new Date(Date.now() - day),
        },
        { title: label(hidden, "draft-entry"), content: "Draft" },
        {
          title: label(hidden, "scheduled-entry"),
          content: "Later",
          publishedAt: new Date(Date.now() + day),
        },
        {
          title: label(hidden, "segment-entry"),
          content: "Segment",
          publishedAt: new Date(Date.now() - day),
          segmentIds: [createId("segment")],
        },
      ])
      .returning({ id: changelogEntries.id });
    await db
      .insert(changelogEntryPosts)
      .values({ changelogEntryId: entry!.id, postId });
    const [roadmap] = await db
      .insert(roadmaps)
      .values([
        { name: "Roadmap", slug: env.id("roadmap") },
        {
          name: label(hidden, "team-roadmap"),
          slug: env.id("roadmap"),
          visibility: "team",
        },
      ])
      .returning({ id: roadmaps.id });
    await db.insert(roadmapColumns).values({
      roadmapId: roadmap!.id,
      statusId: status!.id,
      name: "Open",
      color: "#000000",
    });
    return {
      boardId: pub!.id,
      statusId: status!.id,
      postId,
      postTitle: (
        await db
          .select({ title: posts.title })
          .from(posts)
          .where(eq(posts.id, postId))
      )[0]!.title,
      commentId,
      ownPost,
      ownComment,
      entryId: entry!.id,
      roadmapId: roadmap!.id,
      key: env.id("key"),
      hidden,
      own,
    };
  });
}
export type World = Awaited<ReturnType<typeof world>>;

export type Scene = {
  a: World;
  b: World;
  me: { principalId: string };
  /** Widget scenes: the caller's widget session token. */
  token?: string;
};

/** Workspaces A and B, with customer A (portal) or a widget visitor (widget) as the caller in A. */
export async function scene(
  env: ContractEnv,
  who: "portal" | "widget",
): Promise<Scene> {
  const visitor: { principalId: string; token?: string } =
    who === "portal"
      ? await env.portalCustomer(env.a, env.customerA)
      : await env.widgetVisitor(env.a);
  return {
    a: await world(env, env.a, visitor.principalId),
    b: await world(env, env.b),
    me: visitor,
    token: visitor.token,
  };
}

/** Customer A's posts, comments, votes, reactions and subscriptions in A. */
export const probe = (env: ContractEnv, s: Scene) =>
  env.scoped(env.a, async (db) => {
    const me = s.me.principalId as Id<typeof principal>;
    return {
      posts: await db
        .select({
          id: posts.id,
          title: posts.title,
          content: posts.content,
          deletedAt: posts.deletedAt,
        })
        .from(posts)
        .where(eq(posts.principalId, me))
        .orderBy(posts.id),
      comments: await db
        .select({
          id: postComments.id,
          content: postComments.content,
          deletedAt: postComments.deletedAt,
        })
        .from(postComments)
        .where(eq(postComments.principalId, me))
        .orderBy(postComments.id),
      votes: await db
        .select({ id: postVotes.postId })
        .from(postVotes)
        .where(eq(postVotes.principalId, me))
        .orderBy(postVotes.postId),
      reactions: await db
        .select({ id: postCommentReactions.id })
        .from(postCommentReactions)
        .where(eq(postCommentReactions.principalId, me))
        .orderBy(postCommentReactions.id),
      follows: await db
        .select({ id: postSubscriptions.postId })
        .from(postSubscriptions)
        .where(eq(postSubscriptions.principalId, me))
        .orderBy(postSubscriptions.postId),
    };
  });
