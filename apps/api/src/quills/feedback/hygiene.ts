import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { PostId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  pagingNumber,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { companies } from "../../database/quills/schema/companies";
import { posts, postVotes } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { seesRevenue } from "./schemas";
import { loadProjects, visiblePost } from "./visibility";

export const VOTE_BURST_THRESHOLD = 10;
export const VOTE_BURST_WINDOW_MINUTES = 10;

export type FairVoterInput = {
  principalId: string;
  companyId: string | null;
  mrrCents: number | null;
  churnRisk: boolean;
  importance: string | null;
};

/**
 * Computes a fair demand score (#304) that prevents single-company brigading:
 * - Voters from the same company collapse via log2(1 + companyVoters) instead of linear sum
 * - Distinct companies and solo voters each contribute independently
 * - Churn-risk accounts get a 1.5x boost; critical/important voters nudge weight gently
 */
export function computeFairDemandScore(voters: readonly FairVoterInput[]) {
  const byCompany = new Map<
    string,
    {
      voters: number;
      mrrCents: number;
      churnRisk: boolean;
      importanceBoost: number;
    }
  >();
  let soloScore = 0;

  const importanceWeight = (imp: string | null) =>
    imp === "critical" ? 1.5 : imp === "important" ? 1.2 : 1;

  for (const v of voters) {
    const imp = importanceWeight(v.importance);
    if (!v.companyId) {
      soloScore += imp;
      continue;
    }
    const cur = byCompany.get(v.companyId) ?? {
      voters: 0,
      mrrCents: v.mrrCents ?? 0,
      churnRisk: v.churnRisk,
      importanceBoost: 1,
    };
    cur.voters += 1;
    cur.importanceBoost = Math.max(cur.importanceBoost, imp);
    byCompany.set(v.companyId, cur);
  }

  let companyScore = 0;
  let rawMrrCents = 0;
  let churnRiskCompanies = 0;
  for (const group of byCompany.values()) {
    const cappedVoters = Math.log2(1 + group.voters);
    const riskMultiplier = group.churnRisk ? 1.5 : 1;
    companyScore += cappedVoters * group.importanceBoost * riskMultiplier;
    rawMrrCents += group.mrrCents;
    if (group.churnRisk) churnRiskCompanies += 1;
  }

  return {
    fairScore: Math.round((companyScore + soloScore) * 100) / 100,
    totalVoters: voters.length,
    distinctCompanies: byCompany.size,
    churnRiskCompanies,
    rawMrrCents,
  };
}

/**
 * Checks whether a post received >= VOTE_BURST_THRESHOLD votes in the last 10 minutes (#304).
 * When triggered, flags voteBurstFlaggedAt and records voteBurstCount.
 */
export async function checkVoteBurst(db: Database, postId: PostId) {
  const windowStart = new Date(Date.now() - VOTE_BURST_WINDOW_MINUTES * 60_000);
  const [recent] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postVotes)
    .innerJoin(principal, eq(principal.id, postVotes.principalId))
    .where(
      and(
        eq(postVotes.postId, postId),
        gte(postVotes.createdAt, windowStart),
        isNull(principal.testOwnerPrincipalId),
      ),
    );
  const recentCount = recent?.count ?? 0;
  if (recentCount >= VOTE_BURST_THRESHOLD) {
    await db
      .update(posts)
      .set({
        voteBurstFlaggedAt: sql`coalesce(${posts.voteBurstFlaggedAt}, now())`,
        voteBurstCount: sql`greatest(${posts.voteBurstCount}, ${recentCount})`,
      })
      .where(eq(posts.id, postId));
    return true;
  }
  return false;
}

const findSimilar = defineQuillsRoute({
  method: "get",
  path: "/posts/similar",
  operationId: "findQuillsSimilarPosts",
  summary:
    "Find similar feedback posts using hybrid FTS + trigram matching (no AI required)",
  description:
    "Works out of the box with zero AI provider configured by combining PostgreSQL full-text search and pg_trgm similarity over visible live posts.",
  action: "read",
  query: z.object({
    q: z.string().trim().min(2).max(200),
    boardId: flexibleToTypeIdSchema("board").optional(),
    excludePostId: flexibleToTypeIdSchema("post").optional(),
    limit: pagingNumber(1, 20, 8),
  }),
  load: loadProjects,
  response: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        boardId: z.string(),
        boardName: z.string(),
        statusName: z.string().nullable(),
        voteCount: z.number(),
        similarity: z.number(),
      }),
    ),
  }),
  responseDescription: "Candidate duplicate/similar posts ranked best first",
  handler: async ({ db, query, loaded: projects }) => {
    const tsQuery = sql`websearch_to_tsquery('english', ${query.q})`;
    const escapedLike = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
    const scoreExpr = sql<number>`(
      coalesce(ts_rank(${posts.searchVector}, ${tsQuery}), 0) * 2.0
      + coalesce(word_similarity(${query.q}, ${posts.title}), 0) * 1.5
      + coalesce(similarity(${posts.title}, ${query.q}), 0)
    )`;

    const rows = await db
      .select({
        id: posts.id,
        title: posts.title,
        boardId: posts.boardId,
        boardName: boards.name,
        statusName: postStatuses.name,
        voteCount: posts.voteCount,
        score: scoreExpr,
      })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
      .where(
        and(
          visiblePost(projects),
          isNull(posts.canonicalPostId),
          query.boardId ? eq(posts.boardId, query.boardId) : undefined,
          query.excludePostId ? ne(posts.id, query.excludePostId) : undefined,
          or(
            sql`${posts.searchVector} @@ ${tsQuery}`,
            ilike(posts.title, escapedLike),
            sql`word_similarity(${query.q}, ${posts.title}) >= 0.3`,
            sql`similarity(${posts.title}, ${query.q}) >= 0.2`,
          ),
        ),
      )
      .orderBy(desc(scoreExpr), desc(posts.voteCount), asc(posts.id))
      .limit(query.limit);

    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        boardId: row.boardId,
        boardName: row.boardName,
        statusName: row.statusName,
        voteCount: row.voteCount,
        similarity: Math.round(Number(row.score) * 1000) / 1000,
      })),
    };
  },
});

const hygieneItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  boardId: z.string(),
  boardName: z.string(),
  statusName: z.string().nullable(),
  voteCount: z.number(),
  createdAt: responseTimestamp,
  updatedAt: responseTimestamp,
  firstTeamResponseAt: nullableResponseTimestamp,
  ackDueAt: nullableResponseTimestamp,
  voteBurstFlaggedAt: nullableResponseTimestamp,
  voteBurstCount: z.number(),
});

const fairRankedItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  boardId: z.string(),
  voteCount: z.number(),
  fairScore: z.number(),
  distinctCompanies: z.number(),
  churnRiskCompanies: z.number(),
  mrrCents: z.number().nullable().openapi({
    description: "Null without the quills:view_revenue permission.",
  }),
});

const getHygiene = defineQuillsRoute({
  method: "get",
  path: "/posts/hygiene",
  operationId: "getQuillsFeedbackHygiene",
  summary:
    "Get feedback hygiene queues (unacknowledged, stale, vote-burst) and fair-weighted ranking",
  description:
    "Lists posts awaiting first team acknowledgement, stale open posts, vote-burst-flagged posts, and fair-weighted demand rankings that prevent single-company vote brigading. Revenue is gated by quills:view_revenue.",
  action: "read",
  callerActions: true,
  query: z.object({
    boardId: flexibleToTypeIdSchema("board").optional(),
    staleDays: pagingNumber(1, 365, 60),
    limit: pagingNumber(1, 100, 30),
  }),
  load: loadProjects,
  response: z.object({
    unacknowledged: z.array(hygieneItemSchema),
    staleOpen: z.array(hygieneItemSchema),
    burstFlagged: z.array(hygieneItemSchema),
    fairRanked: z.array(fairRankedItemSchema),
  }),
  responseDescription: "Feedback hygiene lists and fair-weighted rankings",
  handler: async ({ db, query, loaded: projects, actions }) => {
    const withRevenue = seesRevenue(actions);
    const staleCutoff = new Date(Date.now() - query.staleDays * 86_400_000);
    const baseWhere = and(
      visiblePost(projects),
      isNull(posts.canonicalPostId),
      query.boardId ? eq(posts.boardId, query.boardId) : undefined,
    );

    const selectFields = {
      id: posts.id,
      title: posts.title,
      boardId: posts.boardId,
      boardName: boards.name,
      statusName: postStatuses.name,
      voteCount: posts.voteCount,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
      firstTeamResponseAt: posts.firstTeamResponseAt,
      ackDueAt: posts.ackDueAt,
      voteBurstFlaggedAt: posts.voteBurstFlaggedAt,
      voteBurstCount: posts.voteBurstCount,
    };

    const openStatusFilter = or(
      isNull(postStatuses.category),
      sql`${postStatuses.category} not in ('complete', 'closed')`,
    );

    const unacknowledged = await db
      .select(selectFields)
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
      .where(
        and(baseWhere, isNull(posts.firstTeamResponseAt), openStatusFilter),
      )
      .orderBy(asc(posts.createdAt), asc(posts.id))
      .limit(query.limit);

    const staleOpen = await db
      .select(selectFields)
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
      .where(and(baseWhere, lt(posts.updatedAt, staleCutoff), openStatusFilter))
      .orderBy(asc(posts.updatedAt), asc(posts.id))
      .limit(query.limit);

    const burstFlagged = await db
      .select(selectFields)
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
      .where(and(baseWhere, isNotNull(posts.voteBurstFlaggedAt)))
      .orderBy(desc(posts.voteBurstFlaggedAt), asc(posts.id))
      .limit(query.limit);

    const candidatePosts = await db
      .select({
        id: posts.id,
        title: posts.title,
        boardId: posts.boardId,
        voteCount: posts.voteCount,
      })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .where(baseWhere)
      .orderBy(desc(posts.voteCount), desc(posts.createdAt))
      .limit(100);

    const candidateIds = candidatePosts.map((p) => p.id);
    const mergedChildren = candidateIds.length
      ? await db
          .select({ id: posts.id, canonicalPostId: posts.canonicalPostId })
          .from(posts)
          .innerJoin(boards, eq(boards.id, posts.boardId))
          .where(
            and(
              visiblePost(projects),
              inArray(posts.canonicalPostId, candidateIds),
            ),
          )
      : [];
    const canonicalByPostId = new Map<string, string>(
      candidateIds.map((id) => [id, id]),
    );
    for (const child of mergedChildren) {
      if (child.canonicalPostId) {
        canonicalByPostId.set(child.id, child.canonicalPostId);
      }
    }
    const allPostIds = [...canonicalByPostId.keys()];

    const voteRows = allPostIds.length
      ? await db
          .select({
            postId: postVotes.postId,
            principalId: postVotes.principalId,
            importance: postVotes.importance,
            companyId: principal.companyId,
            mrrCents: companies.mrrCents,
            churnRisk: companies.churnRisk,
          })
          .from(postVotes)
          .innerJoin(principal, eq(principal.id, postVotes.principalId))
          .leftJoin(companies, eq(companies.id, principal.companyId))
          .where(
            and(
              inArray(postVotes.postId, allPostIds as never[]),
              isNull(principal.testOwnerPrincipalId),
            ),
          )
      : [];

    const votesByPost = new Map<string, FairVoterInput[]>();
    for (const row of voteRows) {
      const canonicalId = canonicalByPostId.get(row.postId) ?? row.postId;
      const bucket = votesByPost.get(canonicalId) ?? [];
      bucket.push({
        principalId: row.principalId,
        companyId: row.companyId,
        mrrCents: row.mrrCents,
        churnRisk: Boolean(row.churnRisk),
        importance: row.importance,
      });
      votesByPost.set(canonicalId, bucket);
    }

    const fairRanked = candidatePosts
      .map((post) => {
        const score = computeFairDemandScore(votesByPost.get(post.id) ?? []);
        return {
          id: post.id,
          title: post.title,
          boardId: post.boardId,
          voteCount: post.voteCount,
          fairScore: score.fairScore,
          distinctCompanies: score.distinctCompanies,
          churnRiskCompanies: score.churnRiskCompanies,
          mrrCents: withRevenue ? score.rawMrrCents : null,
        };
      })
      .sort((a, b) => b.fairScore - a.fairScore || b.voteCount - a.voteCount)
      .slice(0, query.limit);

    return {
      unacknowledged,
      staleOpen,
      burstFlagged,
      fairRanked,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...findSimilar)
  .openapi(...getHygiene);
