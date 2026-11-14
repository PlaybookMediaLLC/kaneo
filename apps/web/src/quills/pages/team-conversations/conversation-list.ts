import type {
  ListConversationsRequest,
  ListConversationsResponse,
} from "../../api/team/list-conversations";
import type { ListConversationViewsResponse } from "../../api/team/list-conversation-views";
import type { ListPrincipalsResponse } from "../../api/team/list-principals";
import { plainText } from "../../core/plain-text";
import { teamHref } from "../../team/team-href";

// The conversation list model of the inbox and the detail view: which rows a view
// shows, how they group, how a row reads and how its address keeps the list.

export const inboxViews = [
  "queue",
  "open",
  "mine",
  "unassigned",
  "all",
] as const;
export type InboxView = (typeof inboxViews)[number];
export const conversationStatuses = ["open", "snoozed", "closed"] as const;
export type ConversationStatus = (typeof conversationStatuses)[number];
/** The status tabs of a list: a conversation status, or "any" for every status. */
export const listStatuses = [...conversationStatuses, "any"] as const;
export type ListStatus = (typeof listStatuses)[number];
export const priorities = ["urgent", "high", "medium", "low", "none"] as const;
export type Priority = (typeof priorities)[number];

export type Conversation = ListConversationsResponse["items"][number];
export type SavedView = ListConversationViewsResponse["items"][number];
export type Teammate = ListPrincipalsResponse["items"][number];
type Query = ListConversationsRequest["query"];

export const viewTitleKeys: Record<InboxView, string> = {
  queue: "team-conversations.views.queue",
  open: "team-conversations.views.open",
  mine: "team-conversations.views.mine",
  unassigned: "team-conversations.views.unassigned",
  all: "team-conversations.views.all",
};
export const statusKeys: Record<ListStatus, string> = {
  open: "team-conversations.status.open",
  snoozed: "team-conversations.status.snoozed",
  closed: "team-conversations.status.closed",
  any: "team-conversations.status.any",
};
export const priorityKeys: Record<Priority, string> = {
  urgent: "team-conversations.priority.urgent",
  high: "team-conversations.priority.high",
  medium: "team-conversations.priority.medium",
  low: "team-conversations.priority.low",
  none: "team-conversations.priority.none",
};

/** The list that the detail view came from, kept in its address. */
export interface ListContext {
  view: InboxView;
  status: ListStatus;
  /** A pinned conversation view; it replaces the status tab. */
  savedView?: string;
}

const pick = <T extends string>(values: readonly T[], value: unknown, or: T) =>
  values.includes(value as T) ? (value as T) : or;

/**
 * The list context from route values. An unknown value falls back to the default: the "all"
 * view shows every status, the other views the open conversations.
 */
export function readContext(
  values: Record<string, unknown>,
  view?: unknown,
): ListContext {
  const inbox = pick(inboxViews, view ?? values.view, "all");
  return {
    view: inbox,
    status: pick(listStatuses, values.status, inbox === "all" ? "any" : "open"),
    savedView:
      typeof values.savedView === "string" && values.savedView
        ? values.savedView.slice(0, 200)
        : undefined,
  };
}

// ponytail: a pinned view's attribute, kind and ticket rules have no list filter; add them
// when listQuillsConversations accepts them.
const ruleParams: Record<string, (value: string) => Partial<Query>> = {
  status: (value) => ({ status: value as ConversationStatus }),
  priority: (value) => ({ priority: value as Priority }),
  assignee: (value) => ({ assignee: value === "me" ? "mine" : value }),
  team: (value) => ({ teamId: value }),
  tag: (value) => ({ tagId: value }),
  source: (value) => ({ source: value }),
  waiting: () => ({ waitingOnly: "true" }),
};

/**
 * The list query of a view. The queue is the open conversations that wait for a team reply,
 * longest wait first. Elsewhere the status tab filters, unless a pinned view's rules and
 * sort apply instead, inside the view's assignee scope.
 */
export function listQuery(context: ListContext, saved?: SavedView): Query {
  if (context.view === "queue")
    return {
      sort: "waiting",
      limit: "50",
      status: "open",
      waitingOnly: "true",
    };
  const query: Query = {
    sort: saved?.sort ?? "priority",
    limit: "50",
    ...(context.view === "mine" || context.view === "unassigned"
      ? { assignee: context.view }
      : {}),
  };
  if (!saved)
    return context.status === "any"
      ? query
      : { ...query, status: context.status };
  return Object.assign(
    query,
    ...saved.filters.rules.map(
      (rule) => ruleParams[rule.field]?.(String(rule.value ?? "")) ?? {},
    ),
  );
}

/** The rows in priority groups, most urgent first. */
export const priorityGroups = (
  items: readonly Conversation[],
  label: (key: string) => string,
) =>
  priorities.map((priority) => ({
    id: priority,
    label: label(priorityKeys[priority]),
    items: items.filter((item) => item.priority === priority),
  }));

/** The data of one ConversationRow: the subject, then the last message as plain text. */
export function rowData(
  item: Conversation,
  people: ReadonlyMap<string, Teammate>,
  labels: { unknown: string; closed: string },
) {
  const assignee = item.assignedAgentPrincipalId
    ? people.get(item.assignedAgentPrincipalId)
    : undefined;
  return {
    person: { name: item.visitorName ?? item.visitorEmail ?? labels.unknown },
    title: item.subject,
    preview: plainText(item.lastMessagePreview),
    time: item.lastMessageAt,
    assignee: item.assignedAgentPrincipalId
      ? {
          name: assignee?.name ?? labels.unknown,
          avatarUrl: assignee?.avatarUrl,
        }
      : null,
    badge:
      item.status === "closed"
        ? { id: "closed", label: labels.closed, tone: "success" as const }
        : null,
    unread: item.unreadCount > 0,
  };
}

/** Teammates by principal ID. */
export const peopleById = (items: readonly Teammate[] = []) =>
  new Map(items.map((person) => [person.id, person]));

const search = (context: ListContext, withView: boolean) =>
  new URLSearchParams({
    ...(withView ? { view: context.view } : {}),
    status: context.status,
    ...(context.savedView ? { savedView: context.savedView } : {}),
  }).toString();

/** The address of a list view. */
export const listHref = (workspaceId: string, context: ListContext) =>
  `${teamHref(workspaceId, `/conversations/${context.view}`)}?${search(context, false)}`;

/** The address of a conversation, with the list that it came from. */
export const conversationHref = (
  workspaceId: string,
  conversationId: string,
  context: ListContext,
) =>
  `${teamHref(workspaceId, `/conversations/${encodeURIComponent(conversationId)}`)}?${search(context, true)}`;
