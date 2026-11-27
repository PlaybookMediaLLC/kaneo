import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import db from "../../../database";
import { projectTable, taskTable } from "../../../database/schema";
import { withQuillsSystemWorkspace } from "../../../database/quills/client";
import { principal, settings } from "../../../database/quills/schema/auth";
import { boards } from "../../../database/quills/schema/boards";
import { companies } from "../../../database/quills/schema/companies";
import { postTasks } from "../../../database/quills/schema/platform-links";
import { posts, postVotes } from "../../../database/quills/schema/posts";
import type { PiiSafeCustomerContext } from "../utils/format";

/**
 * Loads a PII-redacted summary (vote counts, company names, linked public request titles —
 * never emails, personal names, revenue numbers, or private/hidden/unmoderated/segment/project boards)
 * for a Kaneo task to append to synced GitHub issue bodies (#305).
 */
export async function loadPiiSafeTaskCustomerContext(
  taskId: string,
): Promise<PiiSafeCustomerContext | null> {
  if (typeof db?.select !== "function") return null;
  try {
    const [task] = await db
      .select({ workspaceId: projectTable.workspaceId })
      .from(taskTable)
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .where(eq(taskTable.id, taskId))
      .limit(1);
    if (!task?.workspaceId) return null;

    return await withQuillsSystemWorkspace(task.workspaceId, async (qdb) => {
      // Never sync customer context to external GitHub issues when the workspace portal is disabled or private.
      const [cfg] = await qdb
        .select({ portalConfig: settings.portalConfig })
        .from(settings)
        .limit(1);
      if (cfg?.portalConfig) {
        try {
          const parsed = JSON.parse(cfg.portalConfig) as {
            enabled?: boolean;
            access?: { visibility?: string };
          };
          if (
            parsed.enabled === false ||
            parsed.access?.visibility === "private"
          ) {
            return null;
          }
        } catch {
          return null;
        }
      }

      const links = await qdb
        .select({ postId: postTasks.postId })
        .from(postTasks)
        .where(eq(postTasks.taskId, taskId))
        .limit(50);
      const postIds = links.map((l) => l.postId);
      if (!postIds.length) return null;

      // Match Quills anonymous-public visibility strictly (fail closed on missing access tier).
      const publicPublishedFilter = and(
        isNull(posts.deletedAt),
        isNull(boards.deletedAt),
        isNull(boards.visibleSegmentIds),
        isNull(principal.testOwnerPrincipalId),
        eq(posts.isHidden, false),
        eq(posts.moderationState, "published"),
        sql`${boards.access}->>'view' = 'anonymous'`,
        sql`NOT EXISTS (SELECT 1 FROM quills.board_projects bp WHERE bp.board_id = ${boards.id})`,
      );

      const linkedPosts = await qdb
        .select({
          id: posts.id,
          title: posts.title,
          voteCount: posts.voteCount,
        })
        .from(posts)
        .innerJoin(boards, eq(boards.id, posts.boardId))
        .innerJoin(principal, eq(principal.id, posts.principalId))
        .where(and(inArray(posts.id, postIds), publicPublishedFilter));
      if (!linkedPosts.length) return null;

      const linkedIds = linkedPosts.map((p) => p.id);
      const mergedVisible = await qdb
        .select({ id: posts.id })
        .from(posts)
        .innerJoin(boards, eq(boards.id, posts.boardId))
        .innerJoin(principal, eq(principal.id, posts.principalId))
        .where(
          and(
            publicPublishedFilter,
            or(
              inArray(posts.id, linkedIds),
              inArray(posts.canonicalPostId, linkedIds),
            ),
          ),
        );
      const allPostIds = mergedVisible.map((p) => p.id);

      const companyRows = allPostIds.length
        ? await qdb
            .select({ companyName: companies.name })
            .from(postVotes)
            .innerJoin(principal, eq(principal.id, postVotes.principalId))
            .innerJoin(companies, eq(companies.id, principal.companyId))
            .where(
              and(
                inArray(postVotes.postId, allPostIds),
                isNull(principal.testOwnerPrincipalId),
              ),
            )
        : [];
      const companyNames = [
        ...new Set(companyRows.map((r) => r.companyName).filter(Boolean)),
      ].sort();

      return {
        totalVotes: linkedPosts.reduce((sum, p) => sum + p.voteCount, 0),
        uniqueCompanies: companyNames.length,
        companyNames,
        linkedPostTitles: linkedPosts.map((p) => p.title),
      };
    });
  } catch {
    return null;
  }
}
