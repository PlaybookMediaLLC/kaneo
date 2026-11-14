import type {
  ListConversationsRequest,
  ListConversationsResponse,
} from "../../api/team/list-conversations";
import type { ListConversationViewsResponse } from "../../api/team/list-conversation-views";
import type { ListPrincipalsResponse } from "../../api/team/list-principals";
import { plainText } from "../../core/plain-text";
import { teamHref } from "../../team/team-href";

// The conversation list model of the inbox and the detail view: which rows a view
// shows, how a row reads and how its address keeps the list.

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
/** The status filter of a list: a conversation status, the spam view, or "any" for every status. */
export const listStatuses = [...conversationStatuses, "spam", "any"] as const;
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
  /** A saved conversation view; its rules replace the status filter. */
  savedView?: string;
  /** The search text. */
  search?: string;
}

const pick = <T extends string>(values: readonly T[], value: unknown, or: T) =>
  values.includes(value as T) ? (value as T) : or;
// The router reads "?q=42" as a number, so a number is search text too.
const text = (value: unknown, max: number) =>
  (typeof value === "string" || typeof value === "number") && String(value)
    ? String(value).slice(0, max)
    : undefined;

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
    savedView: text(values.savedView, 200),
    search: text(values.q, 200),
  };
}

// ponytail: a saved view's attribute, kind and ticket rules have no list filter; add them
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
 * longest wait first. Elsewhere the status filter applies, unless a saved view's rules and
 * sort apply instead, inside the view's assignee scope. Spam has its own API view.
 */
export function listQuery(context: ListContext, saved?: SavedView): Query {
  const base = {
    limit: "50",
    ...(context.search ? { search: context.search } : {}),
  };
  if (context.view === "queue" && !saved)
    return { ...base, sort: "waiting", status: "open", waitingOnly: "true" };
  const query: Query = {
    ...base,
    sort: saved?.sort ?? "recent",
    ...(context.view === "mine" || context.view === "unassigned"
      ? { assignee: context.view }
      : {}),
  };
  if (saved)
    return Object.assign(
      query,
      ...saved.filters.rules.map(
        (rule) => ruleParams[rule.field]?.(String(rule.value ?? "")) ?? {},
      ),
    );
  if (context.status === "any") return query;
  if (context.status === "spam") return { ...query, view: "spam" };
  return { ...query, status: context.status };
}

/** The data of one ConversationRow: the subject, then the last message as plain text. */
export function rowData(
  item: Conversation,
  people: ReadonlyMap<string, Teammate>,
  labels: { unknown: string; resolved: string; spam: string },
) {
  const assignee = item.assignedAgentPrincipalId
    ? people.get(item.assignedAgentPrincipalId)
    : undefined;
  const spam = item.endReason === "spam";
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
      item.status !== "closed"
        ? null
        : spam
          ? { id: "spam", label: labels.spam, tone: "error" as const }
          : {
              id: "resolved",
              label: labels.resolved,
              tone: "success" as const,
            },
    unread: item.unreadCount > 0,
  };
}

/** Teammates by principal ID. */
export const peopleById = (items: readonly Teammate[] = []) =>
  new Map(items.map((person) => [person.id, person]));

const search = (
  context: ListContext,
  withView: boolean,
  extra: Record<string, string>,
) =>
  new URLSearchParams({
    ...(withView ? { view: context.view } : {}),
    status: context.status,
    ...(context.savedView ? { savedView: context.savedView } : {}),
    ...(context.search ? { q: context.search } : {}),
    ...extra,
  }).toString();

/** The address of a list view. `extra` adds `new` (new message) or `next` (open the first row). */
export const listHref = (
  workspaceId: string,
  context: ListContext,
  extra: Record<string, string> = {},
) =>
  `${teamHref(workspaceId, `/conversations/${context.view}`)}?${search(context, false, extra)}`;

/** The address of a conversation, with the list that it came from. */
export const conversationHref = (
  workspaceId: string,
  conversationId: string,
  context: ListContext,
) =>
  `${teamHref(workspaceId, `/conversations/${encodeURIComponent(conversationId)}`)}?${search(context, true, {})}`;
