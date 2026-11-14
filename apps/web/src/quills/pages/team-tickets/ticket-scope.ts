import { z } from "zod";
import type { ListPrincipalsResponse } from "../../api/team/list-principals";
import type { ListTicketStatusesResponse } from "../../api/team/list-ticket-statuses";
import type {
  ListTicketsRequest,
  ListTicketsResponse,
} from "../../api/team/list-tickets";
import { teamHref } from "../../team/team-href";
import type { ListGroup } from "../../ui/inbox/grouped-list";
import type { ConversationRowProps } from "../../ui/inbox/conversation-row";

export type Ticket = ListTicketsResponse["items"][number];
export type TicketStatus = ListTicketStatusesResponse["items"][number];
export type Teammate = ListPrincipalsResponse["items"][number];

/** The ticket list in the address. An open ticket keeps it, so Back and J/K use the same list. */
export const ticketSearch = z.object({
  view: z.literal("mine").optional().catch(undefined),
  status: z.string().max(100).optional().catch(undefined),
  // The router reads "?q=123" as a number, so the search text is coerced.
  q: z.coerce.string().max(200).optional().catch(undefined),
  /** The new ticket form fills the main pane. */
  new: z.boolean().optional().catch(undefined),
});

/** The list that a ticket opens from: all tickets or the caller's, the status filter and the search. */
export interface TicketScope {
  mine: boolean;
  /** "open" (every open status), "all", or a ticket status ID. */
  status: string;
  q: string;
}

export const ticketScope = (search: Record<string, unknown>): TicketScope => ({
  mine: search.view === "mine",
  status:
    typeof search.status === "string" && search.status ? search.status : "open",
  q: typeof search.q === "string" ? search.q : "",
});

/** The list query of a scope. The API sorts by priority, so the groups fill in order. */
export const ticketQuery = (
  scope: TicketScope,
): ListTicketsRequest["query"] => ({
  sort: "priority",
  limit: "50",
  ...(scope.mine ? { assignee: "me" } : {}),
  ...(scope.status === "open"
    ? { statusCategory: "open" }
    : scope.status === "all"
      ? {}
      : { statusId: scope.status }),
  ...(scope.q.trim() ? { search: scope.q.trim() } : {}),
});

const query = (scope: TicketScope, creating = false) => {
  const search = new URLSearchParams();
  if (scope.mine) search.set("view", "mine");
  if (scope.status !== "open") search.set("status", scope.status);
  if (scope.q) search.set("q", scope.q);
  if (creating) search.set("new", "true");
  const text = search.toString();
  return text ? `?${text}` : "";
};

/** The address of a ticket. The search keeps the list that it opens from. */
export const ticketHref = (
  workspaceId: string,
  ticketId: string,
  scope: TicketScope,
) =>
  `${teamHref(workspaceId, `/tickets/${encodeURIComponent(ticketId)}`)}${query(scope)}`;

/** The address of the list of a scope, or of its new ticket form. "My tickets" has its own path. */
export const ticketListHref = (
  workspaceId: string,
  scope: TicketScope,
  creating = false,
) =>
  `${teamHref(workspaceId, scope.mine ? "/my-tickets" : "/tickets")}${query({ ...scope, mine: false }, creating)}`;

export const PRIORITY_KEYS = {
  urgent: "team-tickets.priority.urgent",
  high: "team-tickets.priority.high",
  medium: "team-tickets.priority.medium",
  low: "team-tickets.priority.low",
  none: "team-tickets.priority.none",
} as const satisfies Record<Ticket["priority"], string>;

export const PRIORITIES = Object.keys(PRIORITY_KEYS) as Ticket["priority"][];

/** The tickets in priority groups, the most urgent first. */
export const priorityGroups = (
  tickets: readonly Ticket[],
  label: (key: string) => string,
): ListGroup<Ticket>[] =>
  PRIORITIES.map((priority) => ({
    id: priority,
    label: label(PRIORITY_KEYS[priority]),
    items: tickets.filter((ticket) => ticket.priority === priority),
  }));

/** The row of a ticket: the requester, the title, the reference and type, the status badge and the assignee. */
export const ticketRow = (
  ticket: Ticket,
  noRequester: string,
): Omit<ConversationRowProps, "href" | "onOpen"> => ({
  person: {
    name: ticket.requester?.displayName ?? noRequester,
    avatarUrl: ticket.requester?.avatarUrl,
  },
  title: ticket.title,
  preview: [ticket.reference, ticket.ticketType?.name]
    .filter(Boolean)
    .join(" · "),
  badge: {
    id: "status",
    label: ticket.status.name,
    tone: ticket.status.category === "closed" ? "success" : "neutral",
  },
  time: ticket.updatedAt,
  assignee:
    ticket.assignee.principalId || ticket.assignee.teamId
      ? { name: ticket.assignee.displayName ?? ticket.assignee.teamName }
      : null,
});

/** The fill of a ticket status icon: open is empty, pending is half and closed is full. */
export const statusFill = (category: Ticket["status"]["category"]) =>
  ({ open: 0, pending: 0.5, closed: 1 })[category];
