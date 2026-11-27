import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { apiRouter, responseTimestamp, z } from "../../openapi";
import { posts, postVotes } from "../../database/quills/schema/posts";
import {
  releaseNotifications,
  verifiedReleases,
} from "../../database/quills/schema/releases";
import { postStatuses } from "../../database/quills/schema/statuses";
import { tickets, ticketStatuses } from "../../database/quills/schema/tickets";
import { defineQuillsRoute } from "../framework/define-route";
import {
  postVisible,
  principalOf,
  stageOf,
  viewerFor,
  visibleBoards,
} from "../portal/feedback/viewer";

const requestItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["post", "ticket"]),
  title: z.string(),
  stage: z.enum(["open", "planned", "in_progress", "shipped", "closed"]),
  statusLabel: z.string(),
  role: z.enum(["authored", "voted", "requested"]),
  releaseVersion: z.string().nullable(),
  updatedAt: responseTimestamp,
});

const releaseUpdateSchema = z.object({
  id: z.string(),
  releaseId: z.string(),
  version: z.string(),
  subject: z.string(),
  body: z.string(),
  quotedText: z.string().nullable(),
  sentAt: responseTimestamp,
});

/**
 * Unified "My requests" timeline for a widget visitor (#298): returns all visible feedback posts
 * the visitor authored or voted on, all support tickets they requested, plus their personal
 * verified-release notifications. Strictly scoped to `caller.principalId`.
 */
const listMyRequests = defineQuillsRoute({
  audience: "widget",
  method: "get",
  path: "/widget/my-requests",
  operationId: "listQuillsWidgetMyRequests",
  summary:
    "List the visitor's own feedback posts, support tickets, and shipped release updates",
  action: "read",
  response: z.object({
    items: z.array(requestItemSchema),
    releases: z.array(releaseUpdateSchema),
  }),
  responseDescription: "The visitor's unified request timeline",
  handler: async ({ db, caller }) => {
    const viewer = await viewerFor(db, "widget", caller);
    const me = principalOf(viewer);
    const boards = await visibleBoards(db, viewer);
    const boardIds = boards.map((b) => b.id);

    // 1. Posts authored or voted on by this visitor (still visible to them).
    const votedRows = await db
      .select({ postId: postVotes.postId })
      .from(postVotes)
      .where(eq(postVotes.principalId, me))
      .limit(100);
    const votedSet = new Set(votedRows.map((v) => v.postId));

    const postRows = boardIds.length
      ? await db
          .select({
            id: posts.id,
            title: posts.title,
            principalId: posts.principalId,
            updatedAt: posts.updatedAt,
            statusName: postStatuses.name,
            statusSlug: postStatuses.slug,
            statusCategory: postStatuses.category,
          })
          .from(posts)
          .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
          .where(
            and(
              postVisible(viewer, boardIds),
              votedRows.length
                ? or(
                    eq(posts.principalId, me),
                    inArray(
                      posts.id,
                      votedRows.map((v) => v.postId),
                    ),
                  )
                : eq(posts.principalId, me),
            ),
          )
          .orderBy(desc(posts.updatedAt))
          .limit(50)
      : [];

    // 2. Support tickets requested by this visitor.
    const ticketRows = await db
      .select({
        id: tickets.id,
        title: tickets.title,
        updatedAt: tickets.updatedAt,
        statusName: ticketStatuses.name,
        statusCategory: ticketStatuses.category,
      })
      .from(tickets)
      .leftJoin(ticketStatuses, eq(ticketStatuses.id, tickets.statusId))
      .where(
        and(eq(tickets.requesterPrincipalId, me), isNull(tickets.deletedAt)),
      )
      .orderBy(desc(tickets.updatedAt))
      .limit(50);

    // 3. Verified release notifications delivered to this visitor.
    const releaseRows = await db
      .select({
        id: releaseNotifications.id,
        releaseId: releaseNotifications.releaseId,
        version: verifiedReleases.version,
        subject: releaseNotifications.subject,
        body: releaseNotifications.body,
        quotedText: releaseNotifications.quotedText,
        postIds: releaseNotifications.postIds,
        ticketIds: releaseNotifications.ticketIds,
        sentAt: releaseNotifications.sentAt,
      })
      .from(releaseNotifications)
      .innerJoin(
        verifiedReleases,
        eq(verifiedReleases.id, releaseNotifications.releaseId),
      )
      .where(eq(releaseNotifications.principalId, me))
      .orderBy(desc(releaseNotifications.sentAt))
      .limit(20);

    const releaseByPost = new Map<string, string>();
    const releaseByTicket = new Map<string, string>();
    for (const rel of releaseRows) {
      for (const pid of rel.postIds) {
        if (!releaseByPost.has(pid)) releaseByPost.set(pid, rel.version);
      }
      for (const tid of rel.ticketIds) {
        if (!releaseByTicket.has(tid)) releaseByTicket.set(tid, rel.version);
      }
    }

    const items: z.infer<typeof requestItemSchema>[] = [
      ...postRows.map((p) => {
        const mappedStage = stageOf(
          p.statusCategory
            ? { slug: p.statusSlug!, category: p.statusCategory }
            : null,
        );
        return {
          id: p.id,
          kind: "post" as const,
          title: p.title,
          stage: mappedStage ?? ("closed" as const),
          statusLabel: p.statusName ?? "Open",
          role:
            p.principalId === me
              ? ("authored" as const)
              : votedSet.has(p.id)
                ? ("voted" as const)
                : ("authored" as const),
          releaseVersion: releaseByPost.get(p.id) ?? null,
          updatedAt: p.updatedAt,
        };
      }),
      ...ticketRows.map((t) => ({
        id: t.id,
        kind: "ticket" as const,
        title: t.title,
        stage:
          t.statusCategory === "closed"
            ? releaseByTicket.has(t.id)
              ? ("shipped" as const)
              : ("closed" as const)
            : ("open" as const),
        statusLabel: t.statusName ?? "Open",
        role: "requested" as const,
        releaseVersion: releaseByTicket.get(t.id) ?? null,
        updatedAt: t.updatedAt,
      })),
    ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return {
      items: items.slice(0, 50),
      releases: releaseRows.map((r) => ({
        id: r.id,
        releaseId: r.releaseId,
        version: r.version,
        subject: r.subject,
        body: r.body,
        quotedText: r.quotedText,
        sentAt: r.sentAt,
      })),
    };
  },
});

export default apiRouter().openapi(...listMyRequests);
