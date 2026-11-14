import type {
  ListConversationsRequest,
  ListConversationsResponse,
} from "../../api/team/list-conversations";
import type { ListConversationViewsResponse } from "../../api/team/list-conversation-views";
import type { ListPrincipalsResponse } from "../../api/team/list-principals";
import { teamHref } from "../../team/team-href";

// The conversation list model of the inbox and the detail view: which rows a view
// shows, how they group, how a row reads and how its address keeps the list.

export const inboxViews = ["mine", "unassigned", "all"] as const;
export type InboxView = (typeof inboxViews)[number];
export const conversationStatuses = ["open", "snoozed", "closed"] as const;
export type ConversationStatus = (typeof conversationStatuses)[number];
export const priorities = ["urgent", "high", "medium", "low", "none"] as const;
export type Priority = (typeof priorities)[number];

export type Conversation = ListConversationsResponse["items"][number];
export type SavedView = ListConversationViewsResponse["items"][number];
export type Teammate = ListPrincipalsResponse["items"][number];
type Query = ListConversationsRequest["query"];

export const viewTitleKeys: Record<InboxView, string> = {
  mine: "team-conversations.views.mine",
  unassigned: "team-conversations.views.unassigned",
  all: "team-conversations.views.all",
};
export const statusKeys: Record<ConversationStatus, string> = {
  open: "team-conversations.status.open",
  snoozed: "team-conversations.status.snoozed",
  closed: "team-conversations.status.closed",
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
  status: ConversationStatus;
  /** A pinned conversation view; it replaces the status tab. */
  savedView?: string;
}

const pick = <T extends string>(values: readonly T[], value: unknown, or: T) =>
  values.includes(value as T) ? (value as T) : or;

/** The list context from route values. An unknown value falls back to the default. */
export const readContext = (
  values: Record<string, unknown>,
  view?: unknown,
): ListContext => ({
  view: pick(inboxViews, view ?? values.view, "all"),
  status: pick(conversationStatuses, values.status, "open"),
  savedView:
    typeof values.savedView === "string" && values.savedView
      ? values.savedView.slice(0, 200)
      : undefined,
});

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
 * The list query of a view. Without a pinned view the status tab filters. A pinned
 * view's rules and sort apply instead of the status, inside the view's assignee scope.
 */
export function listQuery(context: ListContext, saved?: SavedView): Query {
  const query: Query = {
    sort: saved?.sort ?? "priority",
    limit: "50",
    ...(context.view === "all" ? {} : { assignee: context.view }),
  };
  if (!saved) return { ...query, status: context.status };
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

/** The data of one list row. Without a subject, the last message is the title. */
export function rowData(
  item: Conversation,
  people: ReadonlyMap<string, Teammate>,
  unknown: string,
) {
  const assignee = item.assignedAgentPrincipalId
    ? people.get(item.assignedAgentPrincipalId)
    : undefined;
  return {
    person: { name: item.visitorName ?? item.visitorEmail ?? unknown },
    title: item.subject ?? item.lastMessagePreview ?? unknown,
    preview: item.subject ? item.lastMessagePreview : null,
    chips: item.tags.map((tag) => ({ id: tag.id, label: tag.name })),
    time: item.lastMessageAt,
    assignee: item.assignedAgentPrincipalId
      ? { name: assignee?.name ?? unknown, avatarUrl: assignee?.avatarUrl }
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
