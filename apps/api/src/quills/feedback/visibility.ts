import {
  and,
  eq,
  isNotNull,
  isNull,
  or,
  sql,
  type AnyColumn,
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
import { accessibleProjectIds } from "../framework/platform-reads";

// The one board-visibility rule. A board with project links is visible only when the caller can open
// at least one linked project; a board without links is visible to every teammate. A deleted board is
// never visible: `boardVisible`, `onVisibleBoard` and `visiblePost` check that, `visibleBoard` does not.

/** The `load` step of every route that reads boards or posts: the projects that the caller can open. */
export const loadProjects = (input: { workspaceId: string; userId: string }) =>
  accessibleProjectIds(input.workspaceId, input.userId);

export const notFound = (what: string) =>
  new HTTPException(404, { message: `${what} not found` });

/** The project-link part of the rule, for any column that holds a board ID. */
export const visibleBoard = (boardId: AnyColumn, projects: string[]): SQL => {
  const link = (extra?: SQL) =>
    sql`exists (select 1 from ${boardProjects} where ${and(eq(boardProjects.boardId, boardId), extra)})`;
  // One array parameter, however many projects the caller can open.
  const open = sql`${boardProjects.projectId} = any(${sql.param(projects)}::text[])`;
  return sql`(not ${link()} or ${link(open)})`;
};

/** The project-link part of the rule, for a board whose links were read already. */
export const seesBoard = (
  projects: readonly string[],
  linked: readonly string[],
) => !linked.length || linked.some((id) => projects.includes(id));

/** The `boards` row is live and visible to the caller. */
export const boardVisible = (projects: string[]): SQL =>
  and(isNull(boards.deletedAt), visibleBoard(boards.id, projects))!;

/** The current `posts` row is on a live board that the caller can see. */
export const onVisibleBoard = (projects: string[]): SQL =>
  and(
    sql`exists (select 1 from ${boards} where ${eq(boards.id, posts.boardId)} and ${isNull(boards.deletedAt)})`,
    visibleBoard(posts.boardId, projects),
  )!;

/** False for content written by a test customer. Same rule as database/quills/test-data.ts, which route modules cannot import. */
export const notTest = (principalId: SQLWrapper | TypeId<"principal">): SQL =>
  sql`not exists (select 1 from ${principal} where ${eq(principal.id, principalId)} and ${isNotNull(principal.testOwnerPrincipalId)})`;

/** A post that the caller may see in a list: not deleted, on a live and visible board, not test data. */
export const visiblePost = (projects: string[]): SQL =>
  and(
    isNull(posts.deletedAt),
    onVisibleBoard(projects),
    notTest(posts.principalId),
  )!;

/**
 * A post and the active posts merged into it: one vote per person across all of them.
 * With `projects`, only posts on boards the caller can see.
 */
export const relatedPosts = (
  db: Database,
  postId: TypeId<"post">,
  projects?: string[],
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
        projects && boardVisible(projects),
      ),
    );

export async function findBoard(
  db: Database,
  id: TypeId<"board">,
  projects: string[],
) {
  const [board] = await db
    .select({ id: boards.id, name: boards.name, slug: boards.slug })
    .from(boards)
    .where(and(eq(boards.id, id), boardVisible(projects)))
    .limit(1);
  if (!board) throw notFound("Board");
  return board;
}

/** A post on a visible board. 404 otherwise, so a hidden post looks like a missing one. */
export async function findPost(
  db: Database,
  id: TypeId<"post">,
  projects: string[],
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
        boardVisible(projects),
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
  projects: string[],
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
        boardVisible(projects),
      ),
    )
    .limit(1);
  if (!comment) throw notFound("Comment");
  return comment;
}
