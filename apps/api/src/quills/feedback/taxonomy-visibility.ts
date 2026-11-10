// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
  type AnyColumn,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { boardProjects } from "../../database/quills/schema/platform-links";
import { posts } from "../../database/quills/schema/posts";
import { accessibleProjectIds } from "../framework/platform-reads";

/** `load` for routes that read or change posts: the projects that the caller can open. */
export const loadProjects = ({
  workspaceId,
  userId,
}: {
  workspaceId: string;
  userId: string;
}) => accessibleProjectIds(workspaceId, userId);

/** A board with project links is visible only when the caller can open at least one of them. */
export const visibleBoard = (boardId: AnyColumn, projects: string[]): SQL =>
  sql`(not exists (select 1 from ${boardProjects} where ${eq(boardProjects.boardId, boardId)})
    or exists (select 1 from ${boardProjects} where ${eq(boardProjects.boardId, boardId)} and ${inArray(boardProjects.projectId, projects)}))`;

/** False for content written by a test customer. */
export const notTest = (principalId: SQLWrapper): SQL =>
  sql`not exists (select 1 from ${principal} where ${eq(principal.id, principalId)} and ${isNotNull(principal.testOwnerPrincipalId)})`;

/** The current `posts` row is on a live board that the caller can see. */
export const onVisibleBoard = (projects: string[]): SQL =>
  and(
    sql`exists (select 1 from ${boards} where ${eq(boards.id, posts.boardId)} and ${isNull(boards.deletedAt)})`,
    visibleBoard(posts.boardId, projects),
  )!;

/** A post that the caller may see in a list: not deleted, on a live and visible board, not test data. */
export const visiblePost = (projects: string[]): SQL =>
  and(
    isNull(posts.deletedAt),
    onVisibleBoard(projects),
    notTest(posts.principalId),
  )!;
