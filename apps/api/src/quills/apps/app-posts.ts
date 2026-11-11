import { and, eq, isNull } from "drizzle-orm";
import type { TypeId } from "@kaneo/ids";
import { z } from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import { postExternalLinks } from "../../database/quills/schema/external-links";
import { posts } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { email } from "../directory/people";
import { filterConditions, sorts } from "../feedback/post-filters";
import type { Database } from "../framework/define-route";

// The app's view of posts and of the external items that it links to them.

/** Link types that other features write with no integration: conversation links and import markers. */
const RESERVED_TYPES = ["live_chat", "import"];

export const externalType = z
  .string()
  .trim()
  .toLowerCase()
  .max(50)
  .regex(/^[a-z][a-z0-9_-]*$/)
  .refine((value) => !RESERVED_TYPES.includes(value), "This type is reserved")
  .openapi({ description: "The kind of external item, for example zendesk" });
export const externalKey = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .openapi({ description: "The item's key in the external system" });
export const externalUrl = z.string().trim().url().max(2048).optional();
export const requester = z
  .object({ email, name: z.string().trim().min(1).max(200).optional() })
  .optional()
  .openapi({
    description: "The customer who asked: identified, then the post's voter",
  });

/** Links that an app owns: no integration and no sync scope. */
export const appLinks = and(
  isNull(postExternalLinks.integrationId),
  eq(postExternalLinks.syncScope, ""),
)!;

export const appPost = z.object({
  id: z.string(),
  title: z.string(),
  voteCount: z.number(),
  boardName: z.string(),
  statusName: z.string().nullable(),
  statusColor: z.string().nullable(),
});

/** Posts with their board and status names. The caller adds the visibility rule. */
export const selectAppPosts = <F extends object>(db: Database, extra: F) =>
  db
    .select({
      id: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
      boardName: boards.name,
      statusName: postStatuses.name,
      statusColor: postStatuses.color,
      ...extra,
    })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId));

/** Visible, unmerged posts that match `text`, most voted first. */
export const searchPosts = (
  db: Database,
  text: string,
  limit: number,
  projects: string[],
) =>
  selectAppPosts(db, {})
    .where(
      filterConditions(db, { search: text, showDeleted: "false" }, projects),
    )
    .orderBy(...sorts.votes.order)
    .limit(limit);

/** The vote count of a post. */
export async function voteCountOf(db: Database, postId: TypeId<"post">) {
  const [row] = await db
    .select({ voteCount: posts.voteCount })
    .from(posts)
    .where(eq(posts.id, postId));
  return row!.voteCount;
}
