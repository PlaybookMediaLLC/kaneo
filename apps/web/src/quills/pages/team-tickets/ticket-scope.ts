import type {
  ListTicketsRequest,
  ListTicketsResponse,
} from "../../api/team/list-tickets";
import { teamHref } from "../../team/team-href";
import type { ListGroup } from "../../ui/inbox/grouped-list";
import type { ListRowProps } from "../../ui/inbox/list-row";

export type Ticket = ListTicketsResponse["items"][number];

/** The list that a ticket opens from: all tickets or the caller's, and the status tab. */
export interface TicketScope {
  mine: boolean;
  /** "open" (every open status), "all", or a ticket status ID. */
  status: string;
}

export const ticketScope = (search: Record<string, unknown>): TicketScope => ({
  mine: search.view === "mine",
  status:
    typeof search.status === "string" && search.status ? search.status : "open",
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
});

const query = (scope: TicketScope) => {
  const search = new URLSearchParams();
  if (scope.mine) search.set("view", "mine");
  if (scope.status !== "open") search.set("status", scope.status);
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

/** The address of the list of a scope. "My tickets" has its own path. */
export const ticketListHref = (workspaceId: string, scope: TicketScope) =>
  `${teamHref(workspaceId, scope.mine ? "/my-tickets" : "/tickets")}${query({ ...scope, mine: false })}`;

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

/** The row of a ticket: the requester, the reference, the status and type chips, and the assignee. */
export const ticketRow = (
  ticket: Ticket,
  noRequester: string,
): Omit<ListRowProps, "href" | "onOpen"> => ({
  person: {
    name: ticket.requester?.displayName ?? noRequester,
    avatarUrl: ticket.requester?.avatarUrl,
  },
  shortId: ticket.reference,
  title: ticket.title,
  chips: [
    { id: "status", label: ticket.status.name },
    ...(ticket.ticketType
      ? [{ id: "type", label: ticket.ticketType.name }]
      : []),
  ],
  time: ticket.updatedAt,
  assignee:
    ticket.assignee.principalId || ticket.assignee.teamId
      ? { name: ticket.assignee.displayName ?? ticket.assignee.teamName }
      : null,
});
