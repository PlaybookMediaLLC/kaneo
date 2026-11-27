import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { companies } from "../../database/quills/schema/companies";
import { postTasks } from "../../database/quills/schema/platform-links";
import { posts, postVotes } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { defineQuillsRoute } from "../framework/define-route";
import { taskProjectId } from "../framework/platform-reads";
import { seesRevenue } from "./schemas";
import { loadProjects, visiblePost } from "./visibility";

// Task customer context (#305): surfaces linked feedback posts, unique requesters, and
// companies for a Kaneo task. Enforces BOTH Kaneo project read access (private projects return
// 403 to non-members via the route `project:` guard) AND quills:read, and strictly gates MRR/revenue behind quills:view_revenue.

const getTaskCustomerContext = defineQuillsRoute({
  method: "get",
  path: "/tasks/{taskId}/customer-context",
  operationId: "getQuillsTaskCustomerContext",
  summary: "Get customer demand context for a Kaneo task",
  description:
    "Returns linked feedback posts visible to the caller, unique requesters (no emails), and companies. Enforces both Kaneo task project access and quills:read; MRR is null without quills:view_revenue.",
  action: "read",
  native: { project: ["read"] },
  callerActions: true,
  params: z.object({ taskId: z.string().trim().min(1).max(200) }),
  project: ({ params, workspaceId }) =>
    taskProjectId(workspaceId, params.taskId),
  load: async (ctx) => ({
    projects: await loadProjects(ctx),
  }),
  response: z.object({
    taskId: z.string(),
    summary: z.object({
      totalLinkedPosts: z.number(),
      totalVotes: z.number(),
      uniqueRequesters: z.number(),
      uniqueCompanies: z.number(),
      totalMrrCents: z.number().nullable().openapi({
        description: "Null without the quills:view_revenue permission.",
      }),
    }),
    linkedPosts: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        boardId: z.string(),
        boardName: z.string(),
        statusName: z.string().nullable(),
        voteCount: z.number(),
      }),
    ),
    requesters: z.array(
      z.object({
        principalId: z.string(),
        displayName: z.string().nullable(),
        companyId: z.string().nullable(),
        companyName: z.string().nullable(),
        importance: z.string().nullable(),
      }),
    ),
    companies: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        plan: z.string().nullable(),
        churnRisk: z.boolean(),
        requesterCount: z.number(),
        mrrCents: z.number().nullable().openapi({
          description: "Null without the quills:view_revenue permission.",
        }),
      }),
    ),
  }),
  responseDescription: "Customer demand context for the task",
  errors: { 404: "Task not found or inaccessible" },
  handler: async ({ db, params, loaded, actions }) => {
    const withRevenue = seesRevenue(actions);
    const links = await db
      .select({ postId: postTasks.postId })
      .from(postTasks)
      .where(eq(postTasks.taskId, params.taskId))
      .orderBy(asc(postTasks.createdAt))
      .limit(100);

    const linkedPostIds = links.map((l) => l.postId);
    if (!linkedPostIds.length) {
      return {
        taskId: params.taskId,
        summary: {
          totalLinkedPosts: 0,
          totalVotes: 0,
          uniqueRequesters: 0,
          uniqueCompanies: 0,
          totalMrrCents: withRevenue ? 0 : null,
        },
        linkedPosts: [],
        requesters: [],
        companies: [],
      };
    }

    const visiblePosts = await db
      .select({
        id: posts.id,
        title: posts.title,
        boardId: posts.boardId,
        boardName: boards.name,
        statusName: postStatuses.name,
        voteCount: posts.voteCount,
        authorPrincipalId: posts.principalId,
      })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
      .where(
        and(inArray(posts.id, linkedPostIds), visiblePost(loaded.projects)),
      );

    const postIds = visiblePosts.map((p) => p.id);
    if (!postIds.length) {
      return {
        taskId: params.taskId,
        summary: {
          totalLinkedPosts: 0,
          totalVotes: 0,
          uniqueRequesters: 0,
          uniqueCompanies: 0,
          totalMrrCents: withRevenue ? 0 : null,
        },
        linkedPosts: [],
        requesters: [],
        companies: [],
      };
    }

    // Include visible merged-in child posts' votes as well (never leaking private-project child boards).
    const mergedPosts = await db
      .select({ id: posts.id })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .where(
        and(
          visiblePost(loaded.projects),
          or(
            inArray(posts.id, postIds),
            inArray(posts.canonicalPostId, postIds),
          ),
        ),
      );
    const allPostIds = mergedPosts.map((p) => p.id);

    const voterRows = await db
      .select({
        principalId: principal.id,
        displayName: principal.displayName,
        principalType: principal.type,
        companyId: companies.id,
        companyName: companies.name,
        companyPlan: companies.plan,
        companyChurnRisk: companies.churnRisk,
        companyMrrCents: companies.mrrCents,
        importance: postVotes.importance,
      })
      .from(postVotes)
      .innerJoin(principal, eq(principal.id, postVotes.principalId))
      .leftJoin(companies, eq(companies.id, principal.companyId))
      .where(
        and(
          inArray(postVotes.postId, allPostIds),
          isNull(principal.testOwnerPrincipalId),
        ),
      );

    const requesterMap = new Map<
      string,
      {
        principalId: string;
        displayName: string | null;
        companyId: string | null;
        companyName: string | null;
        importance: string | null;
      }
    >();
    const companyMap = new Map<
      string,
      {
        id: string;
        name: string;
        plan: string | null;
        churnRisk: boolean;
        requesters: Set<string>;
        mrrCents: number | null;
      }
    >();

    for (const row of voterRows) {
      if (!requesterMap.has(row.principalId)) {
        requesterMap.set(row.principalId, {
          principalId: row.principalId,
          displayName:
            row.principalType === "anonymous" ? null : row.displayName,
          companyId: row.companyId,
          companyName: row.companyName,
          importance: row.importance,
        });
      }
      if (row.companyId && row.companyName) {
        const comp = companyMap.get(row.companyId) ?? {
          id: row.companyId,
          name: row.companyName,
          plan: row.companyPlan,
          churnRisk: Boolean(row.companyChurnRisk),
          requesters: new Set<string>(),
          mrrCents: row.companyMrrCents,
        };
        comp.requesters.add(row.principalId);
        companyMap.set(row.companyId, comp);
      }
    }

    const companyList = [...companyMap.values()]
      .sort((a, b) => b.requesters.size - a.requesters.size)
      .map((c) => ({
        id: c.id,
        name: c.name,
        plan: c.plan,
        churnRisk: c.churnRisk,
        requesterCount: c.requesters.size,
        mrrCents: withRevenue ? c.mrrCents : null,
      }));

    const totalMrrCents = withRevenue
      ? [...companyMap.values()].reduce((sum, c) => sum + (c.mrrCents ?? 0), 0)
      : null;

    return {
      taskId: params.taskId,
      summary: {
        totalLinkedPosts: visiblePosts.length,
        totalVotes: visiblePosts.reduce((sum, p) => sum + p.voteCount, 0),
        uniqueRequesters: requesterMap.size,
        uniqueCompanies: companyList.length,
        totalMrrCents,
      },
      linkedPosts: visiblePosts.map(
        ({ authorPrincipalId: _, ...post }) => post,
      ),
      requesters: [...requesterMap.values()],
      companies: companyList,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...getTaskCustomerContext,
);
