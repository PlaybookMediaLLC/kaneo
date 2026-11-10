import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  max,
  min,
  sql,
  type SQL,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import { postTagAssignments, posts } from "../../database/quills/schema/posts";
import { userSegments } from "../../database/quills/schema/segments";
import { defineQuillsRoute } from "../framework/define-route";
import { bucketsBetween, parseBucket } from "./roadmap-buckets";
import { roadmapById, roadmapParams, type Db } from "./roadmaps";
import { pageQuery } from "./schemas";
import { loadProjects, visiblePost } from "./taxonomy-visibility";

type Roadmap = Awaited<ReturnType<typeof roadmapById>>;

/** The roadmap's stored filter. Admin-defined, so it is not limited to public tags. */
function baseFilter(db: Db, { baseFilter: f }: Roadmap): SQL[] {
  const conditions: SQL[] = [];
  if (f.statusIds?.length)
    conditions.push(inArray(posts.statusId, f.statusIds));
  if (f.boardIds?.length) conditions.push(inArray(posts.boardId, f.boardIds));
  if (f.tagIds?.length)
    conditions.push(
      inArray(
        posts.id,
        db
          .select({ id: postTagAssignments.postId })
          .from(postTagAssignments)
          .where(inArray(postTagAssignments.tagId, f.tagIds)),
      ),
    );
  if (f.segmentIds?.length)
    conditions.push(
      inArray(
        posts.principalId,
        db
          .select({ id: userSegments.principalId })
          .from(userSegments)
          .where(inArray(userSegments.segmentId, f.segmentIds)),
      ),
    );
  return conditions;
}

const bucket = z.object({
  id: z.string(),
  label: z.string(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  targetMonth: z.string().nullable(),
  noEta: z.boolean(),
});

const listRoadmapPosts = defineQuillsRoute({
  method: "get",
  path: "/roadmaps/{roadmapId}/posts",
  operationId: "listQuillsRoadmapPosts",
  summary: "List the posts of a roadmap column or date bucket",
  description:
    "Only posts that the caller may see: boards linked to projects need access to one of them, and deleted, merged and test-customer posts are left out. A date roadmap returns its buckets on the first page without bucketId; other pages return null.",
  action: "read",
  params: roadmapParams,
  query: z.object({
    statusId: flexibleToTypeIdSchema("post_status").optional(),
    bucketId: z.string().max(20).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    sort: z.enum(["votes", "newest", "oldest"]).default("votes"),
    ...pageQuery,
  }),
  load: loadProjects,
  response: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        voteCount: z.number(),
        commentCount: z.number(),
        statusId: z.string().nullable(),
        eta: nullableResponseTimestamp,
        board: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
      }),
    ),
    total: z.number(),
    hasMore: z.boolean(),
    buckets: z.array(bucket).nullable(),
  }),
  responseDescription: "One page of visible roadmap posts",
  errors: { 404: "Roadmap not found" },
  handler: async ({ db, params, query, loaded }) => {
    const roadmap = await roadmapById(db, params.roadmapId);
    const frequency = roadmap.frequency ?? "monthly";
    const member = [
      isNull(posts.canonicalPostId),
      visiblePost(loaded),
      ...baseFilter(db, roadmap),
    ];
    const conditions = [...member];
    if (roadmap.type === "column") {
      const statuses = roadmap.columns.map((c) => c.statusId);
      conditions.push(
        inArray(
          posts.statusId,
          query.statusId
            ? statuses.filter((id) => id === query.statusId)
            : statuses,
        ),
      );
    } else if (query.bucketId) {
      const range = parseBucket(query.bucketId, frequency);
      if (!range)
        throw new HTTPException(400, {
          message: "Invalid roadmap date bucket",
        });
      conditions.push(
        range.noEta
          ? isNull(posts.eta)
          : and(
              gte(posts.eta, new Date(range.start!)),
              lt(posts.eta, new Date(range.end!)),
            )!,
      );
    }
    if (query.search)
      conditions.push(
        sql`${posts.searchVector} @@ websearch_to_tsquery('english', ${query.search})`,
      );
    const where = and(...conditions);
    const rows = await db
      .select({
        id: posts.id,
        title: posts.title,
        voteCount: posts.voteCount,
        commentCount: posts.commentCount,
        statusId: posts.statusId,
        eta: posts.eta,
        board: { id: boards.id, name: boards.name, slug: boards.slug },
      })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .where(where)
      .orderBy(
        query.sort === "newest"
          ? desc(posts.createdAt)
          : query.sort === "oldest"
            ? asc(posts.createdAt)
            : desc(posts.voteCount),
        desc(posts.createdAt),
        asc(posts.id),
      )
      .offset(query.offset)
      .limit(query.limit + 1);
    const [total] = await db.select({ n: count() }).from(posts).where(where);
    let buckets = null;
    // The range scans every member post, so only the first page without a bucket pays for it.
    if (roadmap.type === "date" && !query.bucketId && query.offset === 0) {
      const [range] = await db
        .select({ first: min(posts.eta), last: max(posts.eta) })
        .from(posts)
        .where(and(...member));
      buckets = bucketsBetween(
        frequency,
        range?.first ?? null,
        range?.last ?? null,
      );
    }
    return {
      items: rows.slice(0, query.limit),
      total: total!.n,
      hasMore: rows.length > query.limit,
      buckets,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...listRoadmapPosts,
);
