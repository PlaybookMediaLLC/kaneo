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
  pagingNumber,
  z,
} from "../../../openapi";
import {
  boards,
  roadmapColumns,
  roadmaps,
} from "../../../database/quills/schema/boards";
import {
  postTagAssignments,
  posts,
} from "../../../database/quills/schema/posts";
import { userSegments } from "../../../database/quills/schema/segments";
import { defineQuillsRoute, type Database } from "../../framework/define-route";
import { bucketsBetween, parseBucket } from "../../feedback/roadmap-buckets";
import {
  columnFields,
  roadmapById,
  roadmapNotFound,
  roadmapParams,
} from "../../feedback/roadmaps";
import { postVisible, viewerFor, visibleBoards, type Viewer } from "./viewer";

// Public roadmaps (audience: "portal"). A team roadmap never shows; a segment roadmap shows only
// to a signed-in member of one of its segments. The admin filter and segment IDs stay server-side.

type Roadmap = Awaited<ReturnType<typeof roadmapById>>;
const errors = {
  403: "Blocked account or no portal access",
  404: "Roadmap or status not found",
};

const seesRoadmap = (
  viewer: Viewer,
  roadmap: Pick<Roadmap, "visibility" | "visibleSegmentIds">,
) =>
  roadmap.visibility === "public" ||
  (roadmap.visibility === "segment" &&
    viewer.signedIn &&
    (roadmap.visibleSegmentIds ?? []).some((id) =>
      viewer.segmentIds.includes(id),
    ));

/** The roadmap's stored filter, as the teammate roadmap posts route applies it. */
function baseFilter(db: Database, { baseFilter: f }: Roadmap): SQL[] {
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

const column = z.object({
  id: z.string(),
  statusId: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  color: z.string(),
  position: z.number(),
});
const columnOf = ({
  roadmapId: _,
  ...rest
}: z.input<typeof column> & { roadmapId: string }) => rest;

const listRoadmaps = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/portal/roadmaps",
  operationId: "listQuillsPortalRoadmaps",
  summary: "List the roadmaps that the caller may see, with their columns",
  action: "read",
  response: z.object({
    roadmaps: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        description: z.string().nullable(),
        type: z.enum(["column", "date"]),
        frequency: z.enum(["monthly", "quarterly", "semiannual"]).nullable(),
        position: z.number(),
        columns: z.array(column),
      }),
    ),
  }),
  responseDescription: "Roadmaps in position order",
  errors,
  handler: async ({ db, caller }) => {
    const viewer = await viewerFor(db, "portal", caller);
    // ponytail: every live roadmap per request; a workspace keeps a handful.
    const rows = (
      await db
        .select({
          id: roadmaps.id,
          name: roadmaps.name,
          slug: roadmaps.slug,
          description: roadmaps.description,
          type: roadmaps.type,
          frequency: roadmaps.frequency,
          position: roadmaps.position,
          visibility: roadmaps.visibility,
          visibleSegmentIds: roadmaps.visibleSegmentIds,
        })
        .from(roadmaps)
        .where(isNull(roadmaps.deletedAt))
        .orderBy(asc(roadmaps.position), asc(roadmaps.id))
    ).filter((row) => seesRoadmap(viewer, row));
    const columns = rows.length
      ? await db
          .select(columnFields)
          .from(roadmapColumns)
          .where(
            inArray(
              roadmapColumns.roadmapId,
              rows.map((r) => r.id),
            ),
          )
          .orderBy(asc(roadmapColumns.position), asc(roadmapColumns.id))
      : [];
    return {
      roadmaps: rows.map(({ visibility: _, visibleSegmentIds: __, ...r }) => ({
        ...r,
        columns: columns.filter((c) => c.roadmapId === r.id).map(columnOf),
      })),
    };
  },
});

const bucket = z.object({
  id: z.string(),
  label: z.string(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  targetMonth: z.string().nullable(),
  noEta: z.boolean(),
});

const listRoadmapPosts = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/portal/roadmaps/{roadmapId}/posts",
  operationId: "listQuillsPortalRoadmapPosts",
  summary: "List the posts of a roadmap column or date bucket",
  description:
    "Only posts that the caller may see. statusId names one of the roadmap's columns. A date roadmap returns its buckets on the first page without bucketId; other pages return null.",
  action: "read",
  params: roadmapParams,
  query: z.object({
    statusId: flexibleToTypeIdSchema("post_status").optional(),
    bucketId: z.string().max(20).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    sort: z.enum(["votes", "newest", "oldest"]).default("votes"),
    offset: pagingNumber(0, 10000000, 0),
    limit: pagingNumber(1, 100, 20),
  }),
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
  responseDescription: "One page of roadmap posts",
  errors,
  handler: async ({ db, caller, params, query }) => {
    const viewer = await viewerFor(db, "portal", caller);
    const roadmap = await roadmapById(db, params.roadmapId);
    if (!seesRoadmap(viewer, roadmap)) throw roadmapNotFound();
    const statuses = roadmap.columns.map((c) => c.statusId);
    if (query.statusId && !statuses.includes(query.statusId))
      throw new HTTPException(404, { message: "Status not found" });
    const boardList = await visibleBoards(db, viewer);
    const frequency = roadmap.frequency ?? "monthly";
    const member = [
      isNull(posts.canonicalPostId),
      postVisible(
        viewer,
        boardList.map((b) => b.id),
      ),
      ...baseFilter(db, roadmap),
    ];
    const conditions = [...member];
    if (roadmap.type === "column")
      conditions.push(
        inArray(posts.statusId, query.statusId ? [query.statusId] : statuses),
      );
    else if (query.bucketId) {
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

export default apiRouter()
  .openapi(...listRoadmaps)
  .openapi(...listRoadmapPosts);
