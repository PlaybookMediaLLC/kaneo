import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import {
  apiRouter,
  nullableResponseTimestamp,
  pagingNumber,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal, user } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { changelogEntries } from "../../database/quills/schema/changelog";
import { companies } from "../../database/quills/schema/companies";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { helpCenterArticles } from "../../database/quills/schema/kb";
import { posts } from "../../database/quills/schema/posts";
import {
  ticketConversations,
  tickets,
} from "../../database/quills/schema/tickets";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { memberUserIds } from "../framework/platform-reads";
import { isCustomer, realEmail } from "../directory/customer";
import { filterConditions, filters } from "../feedback/post-filters";
import { loadProjects } from "../feedback/visibility";
import { notSpam } from "../support/conversation-list";
import { realConversation } from "../support/conversation-model";
import { testRequester } from "../support/ticket-list";
import {
  bestFirst,
  likeText,
  MIN_CONTAINS_LENGTH,
  searchExcerpt,
  textOrTitle,
  titleContains,
  titleTier,
} from "./search-match";

// Workspace search (the source's ask-search.ts): one ranked list over every kind. Each kind applies
// the visibility rule of its own list in its WHERE clause, before its LIMIT. See ROUTES.md.

const KINDS = [
  "post",
  "conversation",
  "ticket",
  "article",
  "changelog",
  "person",
  "teammate",
  "company",
] as const;
type Kind = (typeof KINDS)[number];
/** The shortest query that searches records. */
const MIN_LENGTH = 2;
/** How deep pages go before the list stops. */
const MAX_DEPTH = 100;

type Search = {
  text: string;
  tsq: SQL;
  /** Rows each kind keeps: enough to know this page and whether another follows. */
  depth: number;
  projects: string[];
  members: string[];
};
type Row = {
  id: string;
  title: string | null;
  content?: string | null;
  subtitle?: string | null;
  updatedAt: Date | null;
  score: number;
};

/** Kept identical to listQuillsChangelog and changelog_entries_search_idx. */
const changelogVector = sql`to_tsvector('english', coalesce(${changelogEntries.title}, '') || ' ' || coalesce(${changelogEntries.content}, ''))`;
const excerptOf = (column: SQL | AnyColumn) =>
  sql<string>`left(${column}, 2000)`;

/**
 * Each parent's best live message that matches the query (internal notes too, as the inbox search),
 * as `best(parent_id, rank, content)`. `parent` names the message's parent record.
 */
function bestMessages(db: Database, s: Search, parent: SQL, paired = false) {
  const rank = sql`ts_rank(${conversationMessages.searchVector}, ${s.tsq}, 32)`;
  let query = db
    .selectDistinctOn([parent], {
      parentId: sql<string>`${parent}`.as("parent_id"),
      rank: sql<number>`${rank}`.as("rank"),
      content: excerptOf(conversationMessages.content).as("content"),
    })
    .from(conversationMessages)
    .$dynamic();
  // A customer ticket's messages live on its paired conversation.
  if (paired)
    query = query.leftJoin(
      ticketConversations,
      and(
        eq(
          ticketConversations.conversationId,
          conversationMessages.conversationId,
        ),
        eq(ticketConversations.ticketType, "customer"),
      ),
    );
  return query
    .where(
      and(
        isNull(conversationMessages.deletedAt),
        sql`${conversationMessages.searchVector} @@ ${s.tsq}`,
        sql`${parent} is not null`,
      ),
    )
    .orderBy(parent, sql`${rank} desc`, desc(conversationMessages.createdAt))
    .as("best");
}

const searchers: Record<Kind, (db: Database, s: Search) => Promise<Row[]>> = {
  post: async (db, s) => {
    const match = textOrTitle(
      s.text,
      s.tsq,
      sql`${posts.searchVector}`,
      sql`${posts.title}`,
    );
    const score = sql<number>`${titleTier(s.text, sql`${posts.title}`)} + ${match.textScore}`;
    return db
      .select({
        id: posts.id,
        title: posts.title,
        content: excerptOf(posts.content),
        updatedAt: posts.updatedAt,
        score,
      })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .where(
        and(filterConditions(db, filters.parse({}), s.projects), match.where),
      )
      .orderBy(...bestFirst(score, posts.updatedAt, posts.id))
      .limit(s.depth);
  },
  conversation: async (db, s) => {
    const best = bestMessages(
      db,
      s,
      sql`${conversationMessages.conversationId}`,
    );
    const subject = textOrTitle(
      s.text,
      s.tsq,
      sql`to_tsvector('english', coalesce(${conversations.subject}, ''))`,
      sql`${conversations.subject}`,
    );
    const score = sql<number>`${titleTier(s.text, sql`${conversations.subject}`)} + greatest(${subject.textScore}, coalesce(${best.rank}, 0))`;
    return db
      .select({
        id: conversations.id,
        title: sql<
          string | null
        >`coalesce(${conversations.subject}, ${principal.displayName})`,
        content: best.content,
        updatedAt: conversations.updatedAt,
        score,
      })
      .from(conversations)
      .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
      .leftJoin(best, sql`${best.parentId} = ${conversations.id}`)
      .where(
        and(
          realConversation,
          notSpam,
          or(subject.where, isNotNull(best.parentId)),
        ),
      )
      .orderBy(...bestFirst(score, conversations.updatedAt, conversations.id))
      .limit(s.depth);
  },
  ticket: async (db, s) => {
    const best = bestMessages(
      db,
      s,
      sql`coalesce(${conversationMessages.ticketId}, ${ticketConversations.ticketId})`,
      true,
    );
    const title = textOrTitle(
      s.text,
      s.tsq,
      sql`to_tsvector('english', ${tickets.title})`,
      sql`${tickets.title}`,
    );
    const score = sql<number>`${titleTier(s.text, sql`${tickets.title}`)} + greatest(${title.textScore}, coalesce(${best.rank}, 0))`;
    return db
      .select({
        id: tickets.id,
        title: tickets.title,
        content: best.content,
        updatedAt: tickets.updatedAt,
        score,
      })
      .from(tickets)
      .leftJoin(best, sql`${best.parentId} = ${tickets.id}`)
      .where(
        and(
          isNull(tickets.deletedAt),
          sql`not ${testRequester}`,
          or(title.where, isNotNull(best.parentId)),
        ),
      )
      .orderBy(...bestFirst(score, tickets.updatedAt, tickets.id))
      .limit(s.depth);
  },
  article: async (db, s) => {
    const match = textOrTitle(
      s.text,
      s.tsq,
      sql`${helpCenterArticles.searchVector}`,
      sql`${helpCenterArticles.title}`,
    );
    const score = sql<number>`${titleTier(s.text, sql`${helpCenterArticles.title}`)} + ${match.textScore}`;
    return db
      .select({
        id: helpCenterArticles.id,
        title: helpCenterArticles.title,
        content: excerptOf(helpCenterArticles.content),
        updatedAt: helpCenterArticles.updatedAt,
        score,
      })
      .from(helpCenterArticles)
      .where(and(isNull(helpCenterArticles.deletedAt), match.where))
      .orderBy(
        ...bestFirst(
          score,
          helpCenterArticles.updatedAt,
          helpCenterArticles.id,
        ),
      )
      .limit(s.depth);
  },
  changelog: async (db, s) => {
    const match = textOrTitle(
      s.text,
      s.tsq,
      changelogVector,
      sql`${changelogEntries.title}`,
    );
    const score = sql<number>`${titleTier(s.text, sql`${changelogEntries.title}`)} + ${match.textScore}`;
    return db
      .select({
        id: changelogEntries.id,
        title: changelogEntries.title,
        content: excerptOf(changelogEntries.content),
        updatedAt: changelogEntries.updatedAt,
        score,
      })
      .from(changelogEntries)
      .where(and(isNull(changelogEntries.deletedAt), match.where))
      .orderBy(
        ...bestFirst(score, changelogEntries.updatedAt, changelogEntries.id),
      )
      .limit(s.depth);
  },
  // People, teammates and companies match only by containing the query.
  person: async (db, s) => {
    if (s.text.length < MIN_CONTAINS_LENGTH) return [];
    const contains = `%${likeText(s.text)}%`;
    const score = titleTier(
      s.text,
      sql`${principal.displayName}`,
      sql`${user.name}`,
      sql`${user.email}`,
    );
    const rows = await db
      .select({
        id: principal.id,
        title: sql<
          string | null
        >`coalesce(nullif(coalesce(${principal.displayName}, ${user.name}), ''), ${user.email})`,
        subtitle: user.email,
        updatedAt: user.updatedAt,
        score,
      })
      .from(principal)
      .innerJoin(user, eq(user.id, principal.userId))
      .where(
        and(
          isCustomer,
          eq(principal.type, "user"),
          or(
            ilike(principal.displayName, contains),
            ilike(user.name, contains),
            ilike(user.email, contains),
          ),
        ),
      )
      .orderBy(...bestFirst(score, user.updatedAt, principal.id))
      .limit(s.depth);
    return rows.map((row) => ({ ...row, subtitle: realEmail(row.subtitle) }));
  },
  teammate: async (db, s) => {
    const contains = titleContains(s.text, principal.displayName);
    if (!contains) return [];
    const score = titleTier(s.text, sql`${principal.displayName}`);
    return (
      db
        .select({
          id: principal.id,
          title: principal.displayName,
          updatedAt: sql<Date | null>`null`,
          score,
        })
        .from(principal)
        .where(
          and(
            // The teammate principal of a current member, as listQuillsPrincipals.
            isNotNull(principal.kaneoUserId),
            inArray(principal.kaneoUserId, [...s.members, ""]),
            contains,
          ),
        )
        // A principal has no update time; the newest teammate breaks a tie.
        .orderBy(...bestFirst(score, principal.createdAt, principal.id))
        .limit(s.depth)
    );
  },
  company: async (db, s) => {
    if (s.text.length < MIN_CONTAINS_LENGTH) return [];
    const contains = `%${likeText(s.text)}%`;
    const score = titleTier(
      s.text,
      sql`${companies.name}`,
      sql`${companies.domain}`,
    );
    return db
      .select({
        id: companies.id,
        title: companies.name,
        subtitle: companies.domain,
        updatedAt: companies.updatedAt,
        score,
      })
      .from(companies)
      .where(
        or(ilike(companies.name, contains), ilike(companies.domain, contains)),
      )
      .orderBy(...bestFirst(score, companies.updatedAt, companies.id))
      .limit(s.depth);
  },
};

const result = z.object({
  kind: z.enum(KINDS),
  id: z.string(),
  title: z.string(),
  excerpt: z.string().nullable(),
  subtitle: z.string().nullable(),
  updatedAt: nullableResponseTimestamp,
  score: z.number(),
});
type Result = z.output<typeof result>;

/** Best first: score, then the newest update, then kind and ID, so pages never repeat a row. */
const compare = (a: Result, b: Result) =>
  b.score - a.score ||
  (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0) ||
  a.kind.localeCompare(b.kind) ||
  a.id.localeCompare(b.id);

const search = defineQuillsRoute({
  method: "get",
  path: "/search",
  operationId: "searchQuillsWorkspace",
  summary: "Search the workspace",
  description:
    "Posts, conversations, tickets, articles, changelog entries, customers, teammates and companies in one ranked list. Each kind shows only records that its own list shows the caller: a post on a board the caller cannot see, a test customer's or spam conversation and a deleted record are never found. A query under 2 characters finds nothing; `offset + limit` stops at 100.",
  action: "read",
  query: z.object({
    q: z.string().trim().max(200),
    kind: z.enum(KINDS).optional(),
    offset: pagingNumber(0, MAX_DEPTH, 0),
    limit: pagingNumber(1, 50, 20),
  }),
  load: async (input) => {
    const [projects, members] = await Promise.all([
      loadProjects(input),
      memberUserIds(input.workspaceId),
    ]);
    return { projects, members };
  },
  response: z.object({ results: z.array(result), hasMore: z.boolean() }),
  responseDescription: "One page of results, best first",
  handler: async ({ db, query, loaded }) => {
    const text = query.q;
    if (text.length < MIN_LENGTH || query.offset >= MAX_DEPTH)
      return { results: [], hasMore: false };
    const end = Math.min(query.offset + query.limit, MAX_DEPTH);
    const s: Search = {
      text,
      tsq: sql`websearch_to_tsquery('english', ${text})`,
      depth: end + 1,
      ...loaded,
    };
    const merged: Result[] = [];
    // One query at a time: the scoped transaction has one connection.
    for (const kind of query.kind ? [query.kind] : KINDS)
      for (const row of await searchers[kind](db, s))
        merged.push({
          kind,
          id: row.id,
          title: row.title ?? "",
          excerpt: row.content ? searchExcerpt(row.content, text) : null,
          subtitle: row.subtitle ?? null,
          updatedAt: row.updatedAt ? new Date(row.updatedAt) : null,
          score: Number(row.score),
        });
    merged.sort(compare);
    return {
      results: merged.slice(query.offset, end),
      hasMore: merged.length > end && end < MAX_DEPTH,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...search,
);
