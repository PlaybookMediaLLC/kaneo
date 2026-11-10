import {
  and,
  eq,
  isNotNull,
  isNull,
  not,
  notExists,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { TypeId } from "@kaneo/ids";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { boardProjects } from "../../database/quills/schema/platform-links";
import { postComments, posts } from "../../database/quills/schema/posts";
import type { Database } from "../framework/define-route";
import { hiddenProjectIds } from "../framework/platform-reads";

/** The `load` step of every feedback route: the projects that hide a board from the caller. */
export const loadHidden = (input: { workspaceId: string; userId: string }) =>
  hiddenProjectIds(input.workspaceId, input.userId);

export const notFound = (what: string) =>
  new HTTPException(404, { message: `${what} not found` });

/**
 * A board is visible when it is not deleted and it has no project link,
 * or a link to a project that the caller can open.
 */
export function boardVisible(hidden: string[]): SQL {
  const active = isNull(boards.deletedAt);
  if (!hidden.length) return active;
  const link = (extra?: SQL) =>
    sql`exists (select 1 from ${boardProjects} where ${and(eq(boardProjects.boardId, boards.id), extra)})`;
  // One array parameter, however many projects are hidden.
  const open = sql`${boardProjects.projectId} <> all(${sql.param(hidden)}::text[])`;
  return and(active, or(not(link()), link(open)))!;
}

/** True for a real author. Same rule as database/quills/test-data.ts, which route modules cannot import. */
export const notTestPrincipal = (
  db: Database,
  id: SQLWrapper | TypeId<"principal">,
) =>
  notExists(
    db
      .select({ id: principal.id })
      .from(principal)
      .where(
        and(
          eq(principal.id, id as TypeId<"principal">),
          isNotNull(principal.testOwnerPrincipalId),
        ),
      ),
  );

/**
 * A post and the active posts merged into it: one vote per person across all of them.
 * With `hidden`, only posts on boards the caller can see.
 */
export const relatedPosts = (
  db: Database,
  postId: TypeId<"post">,
  hidden?: string[],
) =>
  db
    .select({ id: posts.id })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .where(
      and(
        or(
          eq(posts.id, postId),
          and(eq(posts.canonicalPostId, postId), isNull(posts.deletedAt)),
        ),
        hidden && boardVisible(hidden),
      ),
    );

export async function findBoard(
  db: Database,
  id: TypeId<"board">,
  hidden: string[],
) {
  const [board] = await db
    .select({ id: boards.id, name: boards.name, slug: boards.slug })
    .from(boards)
    .where(and(eq(boards.id, id), boardVisible(hidden)))
    .limit(1);
  if (!board) throw notFound("Board");
  return board;
}

/** A post on a visible board. 404 otherwise, so a hidden post looks like a missing one. */
export async function findPost(
  db: Database,
  id: TypeId<"post">,
  hidden: string[],
  includeDeleted = false,
) {
  const [post] = await db
    .select({
      id: posts.id,
      boardId: posts.boardId,
      boardName: boards.name,
      title: posts.title,
      content: posts.content,
      contentJson: posts.contentJson,
      statusId: posts.statusId,
      ownerPrincipalId: posts.ownerPrincipalId,
      isCommentsLocked: posts.isCommentsLocked,
      pinnedCommentId: posts.pinnedCommentId,
      canonicalPostId: posts.canonicalPostId,
      deletedAt: posts.deletedAt,
    })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .where(
      and(
        eq(posts.id, id),
        includeDeleted ? undefined : isNull(posts.deletedAt),
        boardVisible(hidden),
      ),
    )
    .limit(1);
  if (!post) throw notFound("Post");
  return post;
}

/** A comment of an active post on a visible board. 404 otherwise. */
export async function findComment(
  db: Database,
  id: TypeId<"post_comment">,
  hidden: string[],
  includeDeleted = false,
) {
  const [comment] = await db
    .select({
      id: postComments.id,
      postId: postComments.postId,
      parentId: postComments.parentId,
      principalId: postComments.principalId,
      content: postComments.content,
      contentJson: postComments.contentJson,
      isTeamMember: postComments.isTeamMember,
      isPrivate: postComments.isPrivate,
      moderationState: postComments.moderationState,
      deletedAt: postComments.deletedAt,
    })
    .from(postComments)
    .innerJoin(posts, eq(posts.id, postComments.postId))
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .where(
      and(
        eq(postComments.id, id),
        includeDeleted ? undefined : isNull(postComments.deletedAt),
        isNull(posts.deletedAt),
        boardVisible(hidden),
      ),
    )
    .limit(1);
  if (!comment) throw notFound("Comment");
  return comment;
}
