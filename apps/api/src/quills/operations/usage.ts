import { and, count, eq, isNull, sql } from "drizzle-orm";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { aiUsageLog } from "../../database/quills/schema/ai-usage-log";
import { boards } from "../../database/quills/schema/boards";
import { posts } from "../../database/quills/schema/posts";
import { defineQuillsRoute } from "../framework/define-route";
import {
  boardVisible,
  loadHidden,
  notTestPrincipal,
} from "../feedback/visibility";

// Usage counters from the source's /api/v1/admin/usage. Seats and invitations are Kaneo
// membership, so they are not here. Post and board counts skip boards the caller cannot see.

const usage = defineQuillsRoute({
  method: "get",
  path: "/operations/usage",
  operationId: "getQuillsUsage",
  summary: "Get the workspace's Quills usage totals",
  description:
    "AI tokens of successful chat completions in the current UTC month, and live posts and boards on boards the caller can see. Test customers' posts are not counted.",
  action: "manage_settings",
  load: loadHidden,
  response: z.object({
    aiTokensThisMonth: z.number(),
    postCount: z.number(),
    boardCount: z.number(),
  }),
  responseDescription: "Usage totals",
  // A count of AI tokens, not a credential.
  allowKeys: ["aiTokensThisMonth"],
  handler: async ({ db, loaded: hidden }) => {
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const [ai] = await db
      .select({
        tokens: sql<string>`coalesce(sum(${aiUsageLog.totalTokens}), 0)`,
      })
      .from(aiUsageLog)
      .where(
        and(
          sql`${aiUsageLog.createdAt} >= ${monthStart.toISOString()}::timestamptz`,
          eq(aiUsageLog.callType, "chat_completion"),
          eq(aiUsageLog.status, "success"),
        ),
      );
    const [postRow] = await db
      .select({ n: count() })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .where(
        and(
          isNull(posts.deletedAt),
          boardVisible(hidden),
          notTestPrincipal(db, posts.principalId),
        ),
      );
    const [boardRow] = await db
      .select({ n: count() })
      .from(boards)
      .where(boardVisible(hidden));
    return {
      aiTokensThisMonth: Number(ai?.tokens ?? 0),
      postCount: postRow?.n ?? 0,
      boardCount: boardRow?.n ?? 0,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...usage,
);
