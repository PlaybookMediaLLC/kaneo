import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  isValidTypeId,
  type ChangelogId,
  type PostId,
  type TicketId,
} from "@kaneo/ids";
import { apiRouter, nullableResponseTimestamp, z } from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import { changelogEntries } from "../../database/quills/schema/changelog";
import { helpCenterArticles } from "../../database/quills/schema/kb";
import { posts } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import {
  ticketConversations,
  tickets,
  ticketStatuses,
} from "../../database/quills/schema/tickets";
import type { QuillsCaller } from "../framework/audience";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import {
  openHelpCenter,
  visibleArticles,
} from "../content/public/help-center/visibility";
import { entryVisible, shownAt } from "../portal/feedback/changelog";
import { portalUrl } from "../portal/feedback/feeds";
import {
  postVisible,
  title,
  viewerFor,
  visibleBoards,
  type Viewer,
} from "../portal/feedback/viewer";
import { preview } from "./conversation-model";
import { requireSurface, type Customer } from "./customer/model";
import { stageLabels } from "./ticket-view";

// Embed previews for customers: a card for a post, a changelog entry, a help-center article or a
// ticket that rich text or a message embeds. Each kind reuses the customer read rule of its own
// routes, so a card never shows what the caller could not open. A record the caller may not see,
// or that does not exist, answers { unavailable: true } and names nothing.

const KINDS = ["post", "changelog", "article", "ticket"] as const;
type Kind = (typeof KINDS)[number];

const card = z.object({
  title: z.string(),
  url: z.string().nullable(),
});
const response = z.object({
  unavailable: z.boolean(),
  post: card
    .extend({
      postId: z.string(),
      excerpt: z.string().nullable(),
      voteCount: z.number(),
      statusName: z.string().nullable(),
      statusColor: z.string().nullable(),
      boardName: z.string(),
      boardSlug: z.string(),
      createdAt: nullableResponseTimestamp,
    })
    .nullable(),
  changelog: card
    .extend({ entryId: z.string(), publishedAt: nullableResponseTimestamp })
    .nullable(),
  article: card
    .extend({
      articleId: z.string(),
      slug: z.string(),
      excerpt: z.string().nullable(),
      categorySlug: z.string(),
    })
    .nullable(),
  ticket: card
    .extend({
      ticketId: z.string(),
      conversationId: z.string().nullable(),
      reference: z.string(),
      stageLabel: z.string().nullable(),
      createdAt: nullableResponseTimestamp,
    })
    .nullable(),
});
type Preview = z.input<typeof response>;
const none = { post: null, changelog: null, article: null, ticket: null };
const unavailable: Preview = { unavailable: true, ...none };
const excerpt = (text: string | null | undefined) =>
  text?.trim() ? preview(text.trim().replace(/\s+/g, " ")) : null;

/** A kind's own switch that is off (the help center, the tickets tab) reads as unavailable. */
async function unlessClosed<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HTTPException && [403, 404].includes(error.status))
      return null;
    throw error;
  }
}

async function postCard(db: Database, viewer: Viewer, id: string) {
  if (!isValidTypeId(id, "post")) return null;
  const visible = await visibleBoards(db, viewer);
  const [row] = await db
    .select({
      postId: posts.id,
      title: posts.title,
      content: posts.content,
      voteCount: posts.voteCount,
      statusName: postStatuses.name,
      statusColor: postStatuses.color,
      boardName: boards.name,
      boardSlug: boards.slug,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .leftJoin(
      postStatuses,
      and(eq(postStatuses.id, posts.statusId), isNull(postStatuses.deletedAt)),
    )
    .where(
      and(
        eq(posts.id, id as PostId),
        postVisible(
          viewer,
          visible.map((board) => board.id),
        ),
      ),
    )
    .limit(1);
  if (!row) return null;
  const { content, ...rest } = row;
  return {
    ...rest,
    excerpt: excerpt(content),
    path: `/b/${row.boardSlug}/posts/${row.postId}`,
  };
}

async function changelogCard(db: Database, viewer: Viewer, id: string) {
  if (!isValidTypeId(id, "changelog")) return null;
  const [row] = await db
    .select({
      entryId: changelogEntries.id,
      title: changelogEntries.title,
      publishedAt: shownAt,
    })
    .from(changelogEntries)
    .where(
      and(eq(changelogEntries.id, id as ChangelogId), entryVisible(viewer)),
    )
    .limit(1);
  return row ? { ...row, path: `/changelog/${row.entryId}` } : null;
}

async function articleCard(
  db: Database,
  audience: Customer,
  caller: QuillsCaller,
  slug: string,
) {
  return unlessClosed(async () => {
    const viewer = await openHelpCenter(db, caller, audience, undefined, {
      fallback: true,
    });
    const [found] = await visibleArticles(db, viewer, {
      where: eq(helpCenterArticles.slug, slug),
      limit: 1,
      content: true,
    });
    if (!found) return null;
    return {
      articleId: found.id,
      slug: found.slug,
      title: found.title,
      excerpt: excerpt(found.description) ?? excerpt(found.content),
      categorySlug: found.category.slug,
      path: found.path,
    };
  });
}

async function ticketCard(
  db: Database,
  audience: Customer,
  caller: QuillsCaller,
  id: string,
) {
  const me = caller.principalId;
  if (!me || !isValidTypeId(id, "ticket")) return null;
  return unlessClosed(async () => {
    await requireSurface(db, audience, caller, "tickets");
    // The requester's own live customer ticket, as the requester ticket routes read it.
    const [row] = await db
      .select({
        ticketId: tickets.id,
        number: tickets.number,
        title: tickets.title,
        stage: ticketStatuses.publicStage,
        conversationId: ticketConversations.conversationId,
        createdAt: tickets.createdAt,
      })
      .from(tickets)
      .innerJoin(ticketStatuses, eq(ticketStatuses.id, tickets.statusId))
      .leftJoin(
        ticketConversations,
        and(
          eq(ticketConversations.ticketId, tickets.id),
          eq(ticketConversations.ticketType, "customer"),
        ),
      )
      .where(
        and(
          eq(tickets.id, id as TicketId),
          eq(tickets.requesterPrincipalId, me),
          eq(tickets.type, "customer"),
          isNull(tickets.deletedAt),
        ),
      )
      .limit(1);
    if (!row) return null;
    const { number, stage, ...rest } = row;
    return {
      ...rest,
      reference: `#${number}`,
      stageLabel: stage ? (await stageLabels(db))[stage] : null,
      path: row.conversationId ? `/support/${row.conversationId}` : null,
    };
  });
}

/** The embed preview route of one customer audience. */
export const embedRoutes = (audience: Customer) =>
  apiRouter().openapi(
    ...defineQuillsRoute({
      audience,
      // The widget always holds a session (also an anonymous one); portal sign-in is optional.
      signIn: audience === "widget",
      method: "get",
      path: `/${audience}/embed-preview`,
      operationId:
        audience === "widget"
          ? "getQuillsWidgetEmbedPreview"
          : "getQuillsEmbedPreview",
      summary: `Get an embed preview card for the ${title(audience).toLowerCase()}`,
      description:
        "`id` is the post, changelog entry or ticket ID, or the article slug. A record the caller may not see, or that does not exist, answers unavailable: true. A ticket shows only to its requester.",
      action: "read",
      query: z.object({
        kind: z.enum(KINDS),
        id: z.string().min(1).max(200),
      }),
      response,
      responseDescription: "The card, or unavailable",
      errors: {
        403: "Blocked account or no portal access",
        404: `${title(audience)} not found`,
      },
      handler: async ({ db, caller, query, workspaceId }) => {
        // The surface gates first: the portal or widget switch and the private portal answer 404 or 403.
        const viewer = await viewerFor(db, audience, caller);
        const kind: Kind = query.kind;
        const found =
          kind === "post"
            ? await postCard(db, viewer, query.id)
            : kind === "changelog"
              ? await changelogCard(db, viewer, query.id)
              : kind === "article"
                ? await articleCard(db, audience, caller, query.id)
                : await ticketCard(db, audience, caller, query.id);
        if (!found) return unavailable;
        const { path, ...fields } = found;
        return {
          unavailable: false,
          ...none,
          [kind]: { ...fields, url: path && portalUrl(workspaceId, path) },
        };
      },
    }),
  );
