import { and, desc, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { changelogEntries } from "../../database/quills/schema/changelog";
import {
  changelogReactions,
  changelogReads,
} from "../../database/quills/schema/changelog-engagement";
import { defineQuillsRoute } from "../framework/define-route";
import { page, pageQuery } from "./schemas";
import { notTest } from "./visibility";

// Teammate view of changelog engagement (RFC 0003, feature 15): reactions and readers per
// published entry. Counts leave out test customers. Readers are the people whose read mark
// is at or after the entry's publish time.

const list = defineQuillsRoute({
  method: "get",
  path: "/changelog-engagement",
  operationId: "listQuillsChangelogEngagement",
  summary: "List published changelog entries with reaction and read counts",
  description: "Newest publish time first. At most 50 entries per page.",
  action: "read",
  query: z.object({
    offset: pageQuery.offset,
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
  response: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        publishedAt: responseTimestamp,
        readCount: z.number(),
        reactions: z.array(z.object({ emoji: z.string(), count: z.number() })),
      }),
    ),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "One page of entries with their engagement",
  handler: async ({ db, query }) => {
    const rows = await db
      .select({
        id: changelogEntries.id,
        title: changelogEntries.title,
        publishedAt: sql<Date>`${changelogEntries.publishedAt}`.mapWith(
          changelogEntries.publishedAt,
        ),
        readCount: sql<number>`(select count(*)::int from ${changelogReads} where ${changelogReads.lastReadAt} >= ${changelogEntries.publishedAt} and ${notTest(changelogReads.principalId)})`,
      })
      .from(changelogEntries)
      .where(
        and(
          isNull(changelogEntries.deletedAt),
          isNotNull(changelogEntries.publishedAt),
          lte(changelogEntries.publishedAt, sql`now()`),
        ),
      )
      .orderBy(desc(changelogEntries.publishedAt), desc(changelogEntries.id))
      .offset(query.offset)
      .limit(query.limit + 1);
    const result = page(rows, query);
    const ids = result.items.map((row) => row.id);
    const reactions = ids.length
      ? await db
          .select({
            entryId: changelogReactions.changelogEntryId,
            emoji: changelogReactions.emoji,
            count: sql<number>`count(*)::int`,
          })
          .from(changelogReactions)
          .where(
            and(
              inArray(changelogReactions.changelogEntryId, ids),
              notTest(changelogReactions.principalId),
            ),
          )
          .groupBy(
            changelogReactions.changelogEntryId,
            changelogReactions.emoji,
          )
          .orderBy(changelogReactions.emoji)
      : [];
    return {
      items: result.items.map((row) => ({
        ...row,
        reactions: reactions
          .filter((reaction) => reaction.entryId === row.id)
          .map(({ emoji, count }) => ({ emoji, count })),
      })),
      nextOffset: result.nextOffset,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...list,
);
