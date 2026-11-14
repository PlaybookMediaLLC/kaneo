import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import type { PostId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { companies } from "../../database/quills/schema/companies";
import { posts, postVotes } from "../../database/quills/schema/posts";
import { segments, userSegments } from "../../database/quills/schema/segments";
import { postStatuses } from "../../database/quills/schema/statuses";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import type { Sort } from "./post-filters";
import { boardVisible, findPost, loadProjects, notTest } from "./visibility";

// Who asks for a post (RFC 0003, D3, feature 7): voters, their companies and revenue, segments and
// importance, computed at read time. The counted votes are the ones the vote count is made of: on
// the post and on live posts merged into it. Votes on boards that the caller cannot see and votes
// of test customers are left out. A company's revenue counts once per post.

const voted = aliasedTable(posts, "voted_post");

/** The counted votes of each target post, with the target as `postId`. Targets are unmerged posts. */
function countedVotes(
  db: Database,
  targets: PostId[] | SQLWrapper,
  projects: string[],
) {
  return db.$with("counted").as(
    db
      .select({
        postId:
          sql`case when ${inArray(voted.id, targets)} then ${voted.id} else ${voted.canonicalPostId} end`
            .mapWith(voted.id)
            .as("post_id"),
        principalId: postVotes.principalId,
        importance: postVotes.importance,
        companyId: principal.companyId,
      })
      .from(postVotes)
      .innerJoin(voted, eq(voted.id, postVotes.postId))
      .innerJoin(boards, eq(boards.id, voted.boardId))
      .innerJoin(principal, eq(principal.id, postVotes.principalId))
      .where(
        and(
          or(
            inArray(voted.id, targets),
            and(
              inArray(voted.canonicalPostId, targets),
              isNull(voted.deletedAt),
            ),
          ),
          boardVisible(projects),
          isNull(principal.testOwnerPrincipalId),
        ),
      ),
  );
}

export const demandSchema = z.object({
  voters: z.number(),
  companies: z.number().openapi({ description: "Distinct voter companies" }),
  mrrCents: z.number().openapi({
    description:
      "The monthly revenue of the voters' companies, in cents. Each company counts once.",
  }),
  importance: z.object({
    nice: z.number(),
    important: z.number(),
    critical: z.number(),
  }),
});
type Demand = z.output<typeof demandSchema>;

/** The demand of each target post. A post without counted votes reads as zeros. */
export async function demandOf(
  db: Database,
  targets: PostId[],
  projects: string[],
) {
  const found = new Map<string, Demand>();
  const of = (id: string) =>
    found.get(id) ?? {
      voters: 0,
      companies: 0,
      mrrCents: 0,
      importance: { nice: 0, important: 0, critical: 0 },
    };
  if (!targets.length) return of;
  const counted = countedVotes(db, targets, projects);
  const people = (importance?: "nice" | "important" | "critical") =>
    importance
      ? sql<number>`(count(distinct ${counted.principalId}) filter (where ${counted.importance} = ${importance}))::int`
      : sql<number>`count(distinct ${counted.principalId})::int`;
  const voters = await db
    .with(counted)
    .select({
      postId: counted.postId,
      voters: people(),
      nice: people("nice"),
      important: people("important"),
      critical: people("critical"),
    })
    .from(counted)
    .groupBy(counted.postId);
  const pairs = db
    .selectDistinct({ postId: counted.postId, companyId: counted.companyId })
    .from(counted)
    .as("pairs");
  const revenue = await db
    .with(counted)
    .select({
      postId: pairs.postId,
      companies: sql<number>`count(*)::int`,
      mrrCents: sql<number>`coalesce(sum(${companies.mrrCents}), 0)::float8`,
    })
    .from(pairs)
    .innerJoin(companies, eq(companies.id, pairs.companyId))
    .groupBy(pairs.postId);
  for (const row of voters) {
    const money = revenue.find((r) => r.postId === row.postId);
    found.set(row.postId, {
      voters: row.voters,
      companies: money?.companies ?? 0,
      mrrCents: money?.mrrCents ?? 0,
      importance: {
        nice: row.nice,
        important: row.important,
        critical: row.critical,
      },
    });
  }
  return of;
}

/**
 * The revenue of the companies whose people vote on the posts row that `target` names, as SQL,
 * so a list can sort by it. The same counted votes as `demandOf`.
 */
const mrrOf = (db: Database, target: SQL, projects: string[]) =>
  sql`(select coalesce(sum(${companies.mrrCents}), 0) from ${companies} where ${inArray(
    companies.id,
    db
      .select({ id: principal.companyId })
      .from(postVotes)
      .innerJoin(voted, eq(voted.id, postVotes.postId))
      .innerJoin(boards, eq(boards.id, voted.boardId))
      .innerJoin(principal, eq(principal.id, postVotes.principalId))
      .where(
        and(
          or(
            sql`${voted.id} = ${target}`,
            and(
              sql`${voted.canonicalPostId} = ${target}`,
              isNull(voted.deletedAt),
            ),
          ),
          boardVisible(projects),
          isNull(principal.testOwnerPrincipalId),
        ),
      ),
  )})`;

/**
 * The teammate list order by voter revenue, highest first.
 * ponytail: computes the revenue of every listed post per request; store a rollup if lists grow slow.
 */
export function mrrSort(db: Database, projects: string[]): Sort {
  const mrr = mrrOf(db, sql`${posts}.id`, projects);
  return {
    order: [desc(mrr), desc(posts.createdAt), desc(posts.id)],
    key: sql`(${mrr}, ${posts.createdAt}, ${posts.id}) <`,
    cursor: sql`${mrrOf(db, sql`cursor_post.id`, projects)}, cursor_post.created_at, cursor_post.id`,
  };
}

const getDemand = defineQuillsRoute({
  method: "get",
  path: "/posts/{postId}/demand",
  operationId: "getQuillsPostDemand",
  summary: "Get the demand for a post",
  description:
    "Voters, their companies and revenue, the five segments with the most voters, and the importance that voters gave. For a merged post: the demand of the post it was merged into. Votes on boards that the caller cannot see and test customers' votes are left out.",
  action: "read",
  params: z.object({ postId: flexibleToTypeIdSchema("post") }),
  response: demandSchema.extend({
    postId: z.string(),
    segments: z.array(
      z.object({ id: z.string(), name: z.string(), voters: z.number() }),
    ),
  }),
  responseDescription: "Demand",
  errors: { 404: "Post not found" },
  load: loadProjects,
  handler: async ({ db, params, loaded: projects }) => {
    const post = await findPost(db, params.postId, projects);
    const target = post.canonicalPostId ?? post.id;
    const counted = countedVotes(db, [target], projects);
    const voters = sql<number>`count(distinct ${counted.principalId})::int`;
    const top = await db
      .with(counted)
      .select({ id: segments.id, name: segments.name, voters })
      .from(counted)
      .innerJoin(
        userSegments,
        eq(userSegments.principalId, counted.principalId),
      )
      .innerJoin(segments, eq(segments.id, userSegments.segmentId))
      .where(isNull(segments.deletedAt))
      .groupBy(segments.id, segments.name)
      .orderBy(desc(voters), asc(segments.name), asc(segments.id))
      .limit(5);
    return {
      postId: post.id,
      ...(await demandOf(db, [target], projects))(target),
      segments: top,
    };
  },
});

const revenueAtRisk = defineQuillsRoute({
  method: "get",
  path: "/feedback/revenue-at-risk",
  operationId: "getQuillsRevenueAtRisk",
  summary: "Sum the revenue of companies with a critical vote on an open post",
  description:
    "An open post is live, not merged and has no complete or closed status. Votes count as in getQuillsPostDemand. Each company counts once.",
  action: "read",
  response: z.object({
    companies: z.number(),
    mrrCents: z.number().openapi({ description: "Monthly revenue in cents" }),
  }),
  responseDescription: "Revenue at risk",
  load: loadProjects,
  handler: async ({ db, loaded: projects }) => {
    const open = db
      .select({ id: posts.id })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
      .where(
        and(
          isNull(posts.deletedAt),
          isNull(posts.canonicalPostId),
          notTest(posts.principalId),
          boardVisible(projects),
          or(
            isNull(posts.statusId),
            notInArray(postStatuses.category, ["complete", "closed"]),
          ),
        ),
      );
    const counted = countedVotes(db, open, projects);
    const critical = db
      .selectDistinct({ companyId: counted.companyId })
      .from(counted)
      .where(eq(counted.importance, "critical"))
      .as("critical");
    const [row] = await db
      .with(counted)
      .select({
        companies: sql<number>`count(*)::int`,
        mrrCents: sql<number>`coalesce(sum(${companies.mrrCents}), 0)::float8`,
      })
      .from(critical)
      .innerJoin(companies, eq(companies.id, critical.companyId));
    return row ?? { companies: 0, mrrCents: 0 };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getDemand)
  .openapi(...revenueAtRisk);
