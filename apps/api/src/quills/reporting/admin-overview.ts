import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import {
  changelogEntries,
  changelogEntryPosts,
} from "../../database/quills/schema/changelog";
import { conversations } from "../../database/quills/schema/conversation";
import { helpCenterArticles } from "../../database/quills/schema/kb";
import { posts, postVotes } from "../../database/quills/schema/posts";
import {
  statusIncidents,
  statusSubscriptions,
} from "../../database/quills/schema/status";
import { postStatuses } from "../../database/quills/schema/statuses";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { loadProjects, notTest, visiblePost } from "../feedback/visibility";
import { notTestConversation } from "../support/conversation-model";

// The admin home: what waits for the team across support, feedback, changelog, help center and
// status. Feedback rows and counts cover only boards the caller can see; test customers never count.

const LIST = 8;
const postItem = z.object({
  id: z.string(),
  title: z.string(),
  boardName: z.string(),
  statusName: z.string(),
  at: responseTimestamp,
  mine: z.boolean(),
});

/** The count and the newest rows of the posts that match `where`. */
async function postList(
  db: Database,
  where: SQL,
  at: typeof posts.createdAt | typeof posts.updatedAt,
  viewer: string,
) {
  const total = await db.$count(posts, where);
  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      boardName: boards.name,
      statusName: postStatuses.name,
      at,
      owner: posts.ownerPrincipalId,
    })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .innerJoin(postStatuses, eq(postStatuses.id, posts.statusId))
    .where(where)
    .orderBy(desc(at), posts.id)
    .limit(LIST);
  return {
    count: total,
    rows: rows.map(({ owner, ...row }) => ({ ...row, mine: owner === viewer })),
  };
}

const overview = defineQuillsRoute({
  method: "get",
  path: "/reporting/admin-overview",
  operationId: "fetchQuillsAdminOverview",
  summary: "Get the admin overview",
  description:
    "Waiting conversations, ideas to review, shipped ideas not yet in a changelog, momentum over the last 7 days, changelog and help-center drafts and open status incidents. Feedback covers only boards that the caller can see. Test customers are left out.",
  action: "read",
  response: z.object({
    support: z.object({
      waitingCount: z.number(),
      waiting: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          priority: z.string(),
          waitingSince: nullableResponseTimestamp,
          mine: z.boolean(),
        }),
      ),
    }),
    feedback: z.object({
      reviewCount: z.number(),
      completeCount: z.number(),
      review: z.array(postItem),
      announce: z.array(postItem),
    }),
    momentum: z.array(
      z.object({
        postId: z.string(),
        title: z.string(),
        votesLast7d: z.number(),
      }),
    ),
    changelog: z.object({
      drafts: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          status: z.enum(["draft", "scheduled"]),
          publishedAt: nullableResponseTimestamp,
        }),
      ),
    }),
    helpCenter: z.object({
      draftCount: z.number(),
      drafts: z.array(z.object({ id: z.string(), title: z.string() })),
    }),
    status: z.object({
      openIncidentCount: z.number(),
      subscriberCount: z.number(),
    }),
  }),
  responseDescription: "Admin overview",
  load: loadProjects,
  handler: async ({ db, actor, loaded: projects }) => {
    const now = new Date();
    const viewer = actor.principalId;

    const waiting = and(
      notTestConversation,
      isNotNull(conversations.waitingSince),
      ne(conversations.status, "closed"),
    );
    const waitingTotal = await db.$count(conversations, waiting);
    const waitingRows = await db
      .select({
        id: conversations.id,
        subject: conversations.subject,
        preview: conversations.lastMessagePreview,
        priority: conversations.priority,
        waitingSince: conversations.waitingSince,
        assignee: conversations.assignedAgentPrincipalId,
      })
      .from(conversations)
      .where(waiting)
      .orderBy(
        asc(conversations.waitingSince),
        desc(conversations.lastMessageAt),
      )
      .limit(LIST);

    const livePost = and(visiblePost(projects), isNull(posts.canonicalPostId))!;
    const statuses = await db
      .select({
        id: postStatuses.id,
        category: postStatuses.category,
        isDefault: postStatuses.isDefault,
      })
      .from(postStatuses)
      .where(isNull(postStatuses.deletedAt));
    const defaultStatus = statuses.find((s) => s.isDefault);
    const complete = statuses
      .filter((s) => s.category === "complete")
      .map((s) => s.id);
    const empty = { count: 0, rows: [] };
    const review = defaultStatus
      ? await postList(
          db,
          and(livePost, eq(posts.statusId, defaultStatus.id))!,
          posts.createdAt,
          viewer,
        )
      : empty;
    const announce = complete.length
      ? await postList(
          db,
          and(
            livePost,
            inArray(posts.statusId, complete),
            sql`not exists (select 1 from ${changelogEntryPosts} where ${changelogEntryPosts.postId} = ${posts.id})`,
          )!,
          posts.updatedAt,
          viewer,
        )
      : empty;

    const votesLast7d = sql<number>`count(${postVotes.id})::int`;
    const momentum = await db
      .select({ postId: posts.id, title: posts.title, votesLast7d })
      .from(posts)
      .innerJoin(
        postVotes,
        and(
          eq(postVotes.postId, posts.id),
          gte(postVotes.createdAt, new Date(now.getTime() - 7 * 86_400_000)),
          notTest(postVotes.principalId),
        ),
      )
      .where(livePost)
      .groupBy(posts.id, posts.title)
      .orderBy(desc(votesLast7d), posts.id)
      .limit(3);

    const drafts = await db
      .select({
        id: changelogEntries.id,
        title: changelogEntries.title,
        publishedAt: changelogEntries.publishedAt,
      })
      .from(changelogEntries)
      .where(
        and(
          isNull(changelogEntries.deletedAt),
          or(
            isNull(changelogEntries.publishedAt),
            gt(changelogEntries.publishedAt, now),
          ),
        ),
      )
      .orderBy(desc(changelogEntries.updatedAt), changelogEntries.id)
      .limit(2);

    const articleDraft = and(
      isNull(helpCenterArticles.deletedAt),
      isNull(helpCenterArticles.publishedAt),
    );
    const articleTotal = await db.$count(helpCenterArticles, articleDraft);
    const articles = await db
      .select({ id: helpCenterArticles.id, title: helpCenterArticles.title })
      .from(helpCenterArticles)
      .where(articleDraft)
      .orderBy(desc(helpCenterArticles.updatedAt), helpCenterArticles.id)
      .limit(2);

    const incidents = await db.$count(
      statusIncidents,
      and(
        eq(statusIncidents.kind, "incident"),
        isNull(statusIncidents.resolvedAt),
        isNull(statusIncidents.deletedAt),
      ),
    );
    const subscribers = await db.$count(
      statusSubscriptions,
      and(
        isNull(statusSubscriptions.unsubscribedAt),
        notTest(statusSubscriptions.principalId),
      ),
    );

    return {
      support: {
        waitingCount: waitingTotal,
        waiting: waitingRows.map((row) => ({
          id: row.id,
          title: row.subject?.trim() || row.preview?.trim() || "Conversation",
          priority: row.priority,
          waitingSince: row.waitingSince,
          mine: row.assignee === viewer,
        })),
      },
      feedback: {
        reviewCount: review.count,
        completeCount: announce.count,
        review: review.rows,
        announce: announce.rows,
      },
      momentum,
      changelog: {
        drafts: drafts.map((row) => ({
          ...row,
          status: row.publishedAt ? ("scheduled" as const) : ("draft" as const),
        })),
      },
      helpCenter: { draftCount: articleTotal, drafts: articles },
      status: {
        openIncidentCount: incidents,
        subscriberCount: subscribers,
      },
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...overview,
);
