import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import type { IdPrefix, TypeId } from "@kaneo/ids";
import { z } from "../../openapi";
import { postTags } from "../../database/quills/schema/boards";
import { posts, postTagAssignments } from "../../database/quills/schema/posts";
import type { Database } from "../framework/define-route";
import { boardVisible, notTest } from "./visibility";

/** How long a deleted post stays restorable and listed with showDeleted. */
export const RESTORE_MS = 30 * 24 * 60 * 60 * 1000;

const idList = <P extends IdPrefix>(prefix: P) =>
  z
    .string()
    .max(2000)
    .transform((value) => value.split(",").filter(Boolean))
    .pipe(z.array(flexibleToTypeIdSchema(prefix)).max(50))
    .openapi({ type: "string", description: "Comma-separated IDs, at most 50" })
    .optional();
const day = z
  .union([z.iso.date(), z.iso.datetime({ offset: true }).max(64)])
  .refine((value) => !value.startsWith("0000"), "Year 0 is not a date")
  .optional();
/** A date-only `to` bound covers the whole day, as in the source. */
const toDate = (value: string, endOfDay = false) =>
  new Date(endOfDay && value.length === 10 ? `${value}T23:59:59.999Z` : value);

/** The source's inbox filters, shared by the list and the facet counts. */
export const filters = z.object({
  boardIds: idList("board"),
  statusIds: idList("post_status"),
  tagIds: idList("post_tag"),
  owner: z
    .union([z.literal("none"), flexibleToTypeIdSchema("principal")])
    .optional(),
  search: z.string().trim().min(1).max(200).optional(),
  dateFrom: day,
  dateTo: day,
  showDeleted: z.enum(["true", "false"]).default("false"),
});
type Filters = z.output<typeof filters>;
export type Facet = "board" | "status" | "tags" | "deleted";

export const restorable = () =>
  and(
    isNotNull(posts.deletedAt),
    gte(posts.deletedAt, new Date(Date.now() - RESTORE_MS)),
  );

/** The visible posts that match the filters. Each facet count leaves out its own filter. */
export function filterConditions(
  db: Database,
  f: Filters,
  projects: string[],
  omit?: Facet,
) {
  return and(
    omit === "deleted"
      ? undefined
      : f.showDeleted === "true"
        ? restorable()
        : isNull(posts.deletedAt),
    isNull(posts.canonicalPostId),
    notTest(posts.principalId),
    boardVisible(projects),
    omit !== "board" && f.boardIds?.length
      ? inArray(posts.boardId, f.boardIds)
      : undefined,
    omit !== "status" && f.statusIds?.length
      ? inArray(posts.statusId, f.statusIds)
      : undefined,
    omit !== "tags" && f.tagIds?.length
      ? inArray(
          posts.id,
          db
            .select({ id: postTagAssignments.postId })
            .from(postTagAssignments)
            .innerJoin(postTags, eq(postTags.id, postTagAssignments.tagId))
            .where(
              and(
                inArray(postTagAssignments.tagId, f.tagIds),
                isNull(postTags.deletedAt),
              ),
            ),
        )
      : undefined,
    f.owner === "none"
      ? isNull(posts.ownerPrincipalId)
      : f.owner
        ? eq(posts.ownerPrincipalId, f.owner)
        : undefined,
    f.search
      ? sql`${posts.searchVector} @@ websearch_to_tsquery('english', ${f.search})`
      : undefined,
    f.dateFrom ? gte(posts.createdAt, toDate(f.dateFrom)) : undefined,
    f.dateTo ? lte(posts.createdAt, toDate(f.dateTo, true)) : undefined,
  );
}

/** The RICE score of a `posts` row, or -1 when an input is missing. Every input is checked by the table. */
const rice = (row: SQL) =>
  sql`coalesce(${row}.score_reach::float8 * ${row}.score_impact * ${row}.score_confidence / 100 / ${row}.score_effort, -1)`;

export const sorts = {
  newest: {
    order: [desc(posts.createdAt), desc(posts.id)],
    key: sql`(${posts.createdAt}, ${posts.id}) <`,
    cursor: sql`cursor_post.created_at, cursor_post.id`,
  },
  oldest: {
    order: [asc(posts.createdAt), asc(posts.id)],
    key: sql`(${posts.createdAt}, ${posts.id}) >`,
    cursor: sql`cursor_post.created_at, cursor_post.id`,
  },
  votes: {
    order: [desc(posts.voteCount), desc(posts.createdAt), desc(posts.id)],
    key: sql`(${posts.voteCount}, ${posts.createdAt}, ${posts.id}) <`,
    cursor: sql`cursor_post.vote_count, cursor_post.created_at, cursor_post.id`,
  },
  // RFC 0003, D5: reach × impact × confidence% ÷ effort. A post without all four inputs comes last.
  rice: {
    order: [desc(rice(sql`${posts}`)), desc(posts.createdAt), desc(posts.id)],
    key: sql`(${rice(sql`${posts}`)}, ${posts.createdAt}, ${posts.id}) <`,
    cursor: sql`${rice(sql`cursor_post`)}, cursor_post.created_at, cursor_post.id`,
  },
};
export type Sort = (typeof sorts)[keyof typeof sorts];

/**
 * A shuffled order that stays the same for one seed (RFC 0003, D6). The caller makes the seed
 * from the viewer and the day, so a viewer pages through one order and sees a new one tomorrow.
 */
export function randomSort(seed: string): Sort {
  const rank = (id: SQL) => sql`md5(${seed} || ${id}::text)`;
  return {
    order: [asc(rank(sql`${posts.id}`)), asc(posts.id)],
    key: sql`(${rank(sql`${posts.id}`)}, ${posts.id}) >`,
    cursor: sql`${rank(sql`cursor_post.id`)}, cursor_post.id`,
  };
}

/**
 * Rows after the cursor post. Its values are read in SQL, so timestamps keep microseconds.
 * The caller checks first that the cursor post is visible.
 */
export const afterCursor = (
  cursor: TypeId<"post">,
  sort: keyof typeof sorts | Sort,
): SQL => {
  const by = typeof sort === "string" ? sorts[sort] : sort;
  return sql`${by.key} (select ${by.cursor} from ${posts} cursor_post where cursor_post.id = ${sql.param(cursor, posts.id)})`;
};
