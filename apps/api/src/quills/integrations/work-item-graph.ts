// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { TypeId } from "@kaneo/ids";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { postSubscriptions } from "../../database/quills/schema/notifications";
import { postTasks } from "../../database/quills/schema/platform-links";
import { posts, postVotes } from "../../database/quills/schema/posts";
import { ticketPosts } from "../../database/quills/schema/releases";
import {
  ticketConversations,
  tickets,
  ticketStatuses,
} from "../../database/quills/schema/tickets";
import type { Database } from "../framework/define-route";
import { changeStatus } from "../support/ticket-lifecycle";

export interface ReleasePostNode {
  id: TypeId<"post">;
  title: string;
  content: string;
  boardName: string;
  authorPrincipalId: TypeId<"principal"> | null;
}

export interface ReleaseTicketNode {
  id: TypeId<"ticket">;
  title: string;
  requesterPrincipalId: TypeId<"principal"> | null;
}

export interface ReleaseRequesterDigest {
  principalId: TypeId<"principal">;
  displayName: string | null;
  postIds: TypeId<"post">[];
  ticketIds: TypeId<"ticket">[];
  /** Best original customer quote from their own authored post or ticket. */
  quotedText: string | null;
}

export interface ReleaseScope {
  taskIds: string[];
  posts: ReleasePostNode[];
  tickets: ReleaseTicketNode[];
  requesters: ReleaseRequesterDigest[];
}

function excerpt(text: string | null | undefined, max = 180): string | null {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Thin work-item graph seam (#298). Resolves the full customer scope reachable from a set of
 * shipped Kaneo task IDs (plus any explicitly supplied post/ticket IDs) via `quills.post_tasks`
 * and `quills.ticket_posts`. When #297 (`work_item_links`) ships later, only this module needs
 * to extend its edge traversal.
 */
export async function collectReleaseScope(
  db: Database,
  input: {
    taskIds?: readonly string[];
    extraPostIds?: readonly TypeId<"post">[];
    extraTicketIds?: readonly TypeId<"ticket">[];
  },
): Promise<ReleaseScope> {
  const taskIds = [...new Set((input.taskIds ?? []).filter(Boolean))];
  const linkedFromTasks = taskIds.length
    ? await db
        .select({ postId: postTasks.postId })
        .from(postTasks)
        .where(inArray(postTasks.taskId, taskIds))
    : [];

  const postIdSet = new Set<TypeId<"post">>([
    ...linkedFromTasks.map((r) => r.postId),
    ...(input.extraPostIds ?? []),
  ]);
  const postIds = [...postIdSet];

  const postRows = postIds.length
    ? await db
        .select({
          id: posts.id,
          title: posts.title,
          content: posts.content,
          boardName: boards.name,
          authorPrincipalId: posts.principalId,
        })
        .from(posts)
        .innerJoin(boards, eq(boards.id, posts.boardId))
        .where(and(inArray(posts.id, postIds), isNull(posts.deletedAt)))
    : [];

  const ticketLinksFromPosts = postRows.length
    ? await db
        .select({
          ticketId: ticketPosts.ticketId,
          postId: ticketPosts.postId,
        })
        .from(ticketPosts)
        .where(
          inArray(
            ticketPosts.postId,
            postRows.map((p) => p.id),
          ),
        )
    : [];

  const ticketIdSet = new Set<TypeId<"ticket">>([
    ...ticketLinksFromPosts.map((r) => r.ticketId),
    ...(input.extraTicketIds ?? []),
  ]);
  const ticketIds = [...ticketIdSet];

  const ticketRows = ticketIds.length
    ? await db
        .select({
          id: tickets.id,
          title: tickets.title,
          requesterPrincipalId: tickets.requesterPrincipalId,
        })
        .from(tickets)
        .where(and(inArray(tickets.id, ticketIds), isNull(tickets.deletedAt)))
    : [];

  // Collect every customer principal affected across post authors, voters, subscribers, and ticket requesters.
  const byPrincipal = new Map<
    TypeId<"principal">,
    {
      postIds: Set<TypeId<"post">>;
      ticketIds: Set<TypeId<"ticket">>;
      quotedText: string | null;
    }
  >();

  const ensure = (pid: TypeId<"principal">) => {
    let entry = byPrincipal.get(pid);
    if (!entry) {
      entry = {
        postIds: new Set(),
        ticketIds: new Set(),
        quotedText: null,
      };
      byPrincipal.set(pid, entry);
    }
    return entry;
  };

  const livePostIds = postRows.map((p) => p.id);

  for (const post of postRows) {
    if (post.authorPrincipalId) {
      const entry = ensure(post.authorPrincipalId);
      entry.postIds.add(post.id);
      if (!entry.quotedText) {
        entry.quotedText = excerpt(post.content || post.title);
      }
    }
  }

  if (livePostIds.length) {
    const voters = await db
      .select({
        principalId: postVotes.principalId,
        postId: postVotes.postId,
      })
      .from(postVotes)
      .where(inArray(postVotes.postId, livePostIds));
    for (const v of voters) {
      ensure(v.principalId).postIds.add(v.postId);
    }

    const subs = await db
      .select({
        principalId: postSubscriptions.principalId,
        postId: postSubscriptions.postId,
      })
      .from(postSubscriptions)
      .where(
        and(
          inArray(postSubscriptions.postId, livePostIds),
          eq(postSubscriptions.notifyStatusChanges, true),
        ),
      );
    for (const s of subs) {
      ensure(s.principalId).postIds.add(s.postId);
    }
  }

  for (const ticket of ticketRows) {
    if (ticket.requesterPrincipalId) {
      const entry = ensure(ticket.requesterPrincipalId);
      entry.ticketIds.add(ticket.id);
      if (!entry.quotedText) {
        entry.quotedText = excerpt(ticket.title);
      }
    }
  }

  // Filter to real non-blocked customer principals (never service/test principals).
  const candidateIds = [...byPrincipal.keys()];
  const validCustomers = candidateIds.length
    ? await db
        .select({
          id: principal.id,
          displayName: principal.displayName,
        })
        .from(principal)
        .where(
          and(
            inArray(principal.id, candidateIds),
            isNull(principal.blockedAt),
            isNull(principal.testOwnerPrincipalId),
            ne(principal.type, "service"),
          ),
        )
    : [];

  const postTitleById = new Map(postRows.map((p) => [p.id, p.title]));
  const requesters: ReleaseRequesterDigest[] = validCustomers.map((c) => {
    const data = byPrincipal.get(c.id)!;
    const pIds = [...data.postIds];
    const tIds = [...data.ticketIds];
    const fallbackTitle = pIds.length ? postTitleById.get(pIds[0]!) : null;
    return {
      principalId: c.id,
      displayName: c.displayName,
      postIds: pIds,
      ticketIds: tIds,
      quotedText: data.quotedText ?? excerpt(fallbackTitle),
    };
  });

  return {
    taskIds,
    posts: postRows,
    tickets: ticketRows,
    requesters,
  };
}

/**
 * Reopens any solved/closed support tickets linked to a conversation when the customer sends a
 * follow-up message (e.g., replying after a release closed their ticket, #298).
 * Skips spam-ended threads (caller checks `endReason !== "spam"`).
 */
export async function reopenLinkedTicketsForConversation(
  db: Database,
  conversationId: TypeId<"conversation">,
  actorPrincipalId: TypeId<"principal">,
): Promise<number> {
  const links = await db
    .select({ ticketId: ticketConversations.ticketId })
    .from(ticketConversations)
    .where(eq(ticketConversations.conversationId, conversationId));
  if (!links.length) return 0;

  const linkedTickets = await db
    .select()
    .from(tickets)
    .where(
      and(
        inArray(
          tickets.id,
          links.map((l) => l.ticketId),
        ),
        isNull(tickets.deletedAt),
      ),
    )
    .orderBy(asc(tickets.id))
    .for("update");
  if (!linkedTickets.length) return 0;

  const statuses = await db
    .select()
    .from(ticketStatuses)
    .where(isNull(ticketStatuses.deletedAt))
    .orderBy(asc(ticketStatuses.position));

  const closedIds = new Set(
    statuses.filter((s) => s.category === "closed").map((s) => s.id),
  );
  const openTarget =
    statuses.find((s) => s.category === "open" && s.isDefault) ??
    statuses.find((s) => s.category === "open") ??
    statuses.find((s) => s.category !== "closed");
  if (!openTarget) return 0;

  let reopened = 0;
  for (const ticket of linkedTickets) {
    if (!closedIds.has(ticket.statusId)) continue;
    await changeStatus(
      db,
      {
        principalId: actorPrincipalId,
        userId: "",
        workspaceId: ticket.workspaceId,
      },
      ticket,
      openTarget,
      false,
    );
    reopened += 1;
  }
  return reopened;
}
