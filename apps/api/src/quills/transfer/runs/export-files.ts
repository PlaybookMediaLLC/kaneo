import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "../../../database/quills/client";
import { principal, user } from "../../../database/quills/schema/auth";
import { boards } from "../../../database/quills/schema/boards";
import { companies } from "../../../database/quills/schema/companies";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import { postComments, posts } from "../../../database/quills/schema/posts";
import { postStatuses } from "../../../database/quills/schema/statuses";
import { isCustomer, realEmail } from "../../directory/customer";
import { notTest, visiblePost } from "../../feedback/visibility";
import { notTestConversation } from "../../support/conversation-model";
import { csvLines } from "./csv";
import type { exportKinds } from "./export-runs";

// The CSV of each export kind, read as the run's initiator may read it: posts on boards the
// initiator can see, no deleted rows and no test customers.

const MAX_EXPORT_ROWS = 50_000;
const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
/** Rows per read: the file is built page by page, so memory stays near the byte limit. */
const PAGE = 1000;

type Kind = (typeof exportKinds)[number];
type Built = { csv: string; count: number } | { error: string };
type Page = { offset: number; limit: number };

const count = (query: ReturnType<typeof sql>) =>
  sql<number>`(${query})::int`.mapWith(Number);

async function postsCsv(db: Database, projects: string[], page: Page) {
  const rows = await db
    .select({
      title: posts.title,
      content: posts.content,
      status: postStatuses.name,
      tags: sql<
        string | null
      >`(select string_agg(t.name, ',' order by t.name) from quills."post_tag_assignments" a join quills."post_tags" t on t.id = a.tag_id and t.workspace_id = a.workspace_id where a.post_id = ${posts.id} and t.deleted_at is null)`,
      board: boards.slug,
      authorName: principal.displayName,
      authorEmail: user.email,
      votes: count(
        sql`select count(*) from quills."post_votes" v where v.post_id = ${posts.id} and ${notTest(sql`v.principal_id`)}`,
      ),
      createdAt: posts.createdAt,
    })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
    .leftJoin(principal, eq(principal.id, posts.principalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(visiblePost(projects))
    .orderBy(asc(posts.createdAt), asc(posts.id))
    .offset(page.offset)
    .limit(page.limit);
  return {
    header: [
      "title",
      "content",
      "status",
      "tags",
      "board",
      "author_name",
      "author_email",
      "vote_count",
      "created_at",
    ],
    rows: rows.map((r) => [
      r.title,
      r.content,
      r.status,
      r.tags,
      r.board,
      r.authorName,
      realEmail(r.authorEmail),
      r.votes,
      r.createdAt,
    ]),
  };
}

async function usersCsv(db: Database, projects: string[], page: Page) {
  // Activity counts only cover posts that the initiator can see.
  const visible = visiblePost(projects);
  const rows = await db
    .select({
      name: user.name,
      email: user.email,
      contactEmail: principal.contactEmail,
      verified: user.emailVerified,
      joinedAt: principal.createdAt,
      postCount: count(
        sql`select count(*) from ${posts} where ${posts.principalId} = ${principal.id} and ${visible}`,
      ),
      commentCount: count(
        sql`select count(*) from ${postComments} join ${posts} on ${posts.id} = ${postComments.postId} where ${postComments.principalId} = ${principal.id} and ${postComments.deletedAt} is null and ${visible}`,
      ),
      voteCount: count(
        sql`select count(*) from quills."post_votes" v join ${posts} on ${posts.id} = v.post_id where v.principal_id = ${principal.id} and ${visible}`,
      ),
    })
    .from(principal)
    .innerJoin(user, eq(user.id, principal.userId))
    .where(isCustomer)
    .orderBy(asc(principal.createdAt), asc(principal.id))
    .offset(page.offset)
    .limit(page.limit);
  return {
    header: [
      "name",
      "email",
      "verified",
      "joined_at",
      "post_count",
      "comment_count",
      "vote_count",
    ],
    rows: rows.map((r) => [
      r.name,
      realEmail(r.email) ?? realEmail(r.contactEmail),
      r.verified,
      r.joinedAt,
      r.postCount,
      r.commentCount,
      r.voteCount,
    ]),
  };
}

async function companiesCsv(db: Database, page: Page) {
  const rows = await db
    .select({
      name: companies.name,
      domain: companies.domain,
      externalId: companies.externalId,
      plan: companies.plan,
      mrrCents: companies.mrrCents,
      people: count(
        sql`select count(*) from ${principal} where ${principal.companyId} = ${companies.id} and ${principal.testOwnerPrincipalId} is null and ${principal.kaneoUserId} is null`,
      ),
      createdAt: companies.createdAt,
    })
    .from(companies)
    .orderBy(asc(companies.createdAt), asc(companies.id))
    .offset(page.offset)
    .limit(page.limit);
  return {
    header: [
      "name",
      "domain",
      "external_id",
      "plan",
      "monthly_spend",
      "people_count",
      "created_at",
    ],
    rows: rows.map((r) => [
      r.name,
      r.domain,
      r.externalId,
      r.plan,
      r.mrrCents === null ? null : (r.mrrCents / 100).toFixed(2),
      r.people,
      r.createdAt,
    ]),
  };
}

async function conversationsCsv(db: Database, page: Page) {
  const author = sql<
    string | null
  >`(select a.display_name from ${principal} a where a.id = ${conversationMessages.principalId})`;
  const rows = await db
    .select({
      conversationId: conversations.id,
      subject: conversations.subject,
      status: conversations.status,
      channel: conversations.channel,
      visitorName: principal.displayName,
      visitorEmail: user.email,
      messageId: conversationMessages.id,
      senderType: conversationMessages.senderType,
      authorName: author,
      internal: conversationMessages.isInternal,
      content: conversationMessages.content,
      createdAt: conversationMessages.createdAt,
    })
    .from(conversationMessages)
    .innerJoin(
      conversations,
      eq(conversations.id, conversationMessages.conversationId),
    )
    .leftJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(
      and(
        isNotNull(conversationMessages.conversationId),
        isNull(conversationMessages.deletedAt),
        notTestConversation,
      ),
    )
    .orderBy(
      asc(conversations.id),
      asc(conversationMessages.createdAt),
      asc(conversationMessages.id),
    )
    .offset(page.offset)
    .limit(page.limit);
  return {
    header: [
      "conversation_id",
      "subject",
      "status",
      "channel",
      "visitor_name",
      "visitor_email",
      "message_id",
      "sender_type",
      "author_name",
      "internal",
      "content",
      "created_at",
    ],
    rows: rows.map((r) => [
      r.conversationId,
      r.subject,
      r.status,
      r.channel,
      r.visitorName,
      realEmail(r.visitorEmail),
      r.messageId,
      r.senderType,
      r.authorName,
      r.internal,
      r.content,
      r.createdAt,
    ]),
  };
}

/** Builds the CSV of one export kind, or the reason it cannot: an export is bounded. */
export async function buildExport(
  db: Database,
  kind: Kind,
  projects: string[],
): Promise<Built> {
  const read = (page: Page) =>
    kind === "posts"
      ? postsCsv(db, projects, page)
      : kind === "users"
        ? usersCsv(db, projects, page)
        : kind === "companies"
          ? companiesCsv(db, page)
          : conversationsCsv(db, page);
  const parts: string[] = [];
  let bytes = 0;
  let count = 0;
  // The pages read one snapshot (the job opens the transaction with `snapshot`), so offsets are stable.
  for (let offset = 0; ; offset += PAGE) {
    const { header, rows } = await read({ offset, limit: PAGE });
    const chunk = csvLines(offset ? rows : [header, ...rows]);
    parts.push(chunk);
    bytes += Buffer.byteLength(chunk);
    count += rows.length;
    if (count > MAX_EXPORT_ROWS)
      return { error: "The export has more than 50,000 rows" };
    if (bytes > MAX_EXPORT_BYTES)
      return { error: "The export is larger than 64 MB" };
    if (rows.length < PAGE) return { csv: parts.join(""), count };
  }
}
