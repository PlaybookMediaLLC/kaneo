import {
  AlarmClock,
  CircleCheck,
  Inbox,
  type LucideIcon,
  MessagesSquare,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import type { CreateConversationViewRequest } from "../../api/team/create-conversation-view";
import {
  viewTitleKeys,
  type InboxView,
  type ListContext,
  type ListStatus,
  type SavedView,
} from "./conversation-list";

export interface ListFilter {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  view: InboxView;
  status: ListStatus;
  /** Starts a new group in the menu, after a divider. */
  group?: boolean;
}

/** The filter menu of design section 2. Unread and Archived have no API filter, so they are left out. */
export const listFilters: readonly ListFilter[] = [
  {
    id: "open",
    labelKey: "team-conversations.views.open",
    icon: Inbox,
    view: "open",
    status: "open",
  },
  {
    id: "mine",
    labelKey: "team-conversations.views.mine",
    icon: UserRound,
    view: "mine",
    status: "open",
  },
  {
    id: "all",
    labelKey: "team-conversations.views.all",
    icon: MessagesSquare,
    view: "all",
    status: "any",
  },
  {
    id: "snoozed",
    labelKey: "team-conversations.filters.snoozed",
    icon: AlarmClock,
    view: "all",
    status: "snoozed",
  },
  {
    id: "resolved",
    labelKey: "team-conversations.filters.resolved",
    icon: CircleCheck,
    view: "all",
    status: "closed",
  },
  {
    id: "spam",
    labelKey: "team-conversations.filters.spam",
    icon: ShieldAlert,
    view: "all",
    status: "spam",
    group: true,
  },
];

const SAVED = "view:";
/** The menu value of a saved view. */
export const savedValue = (id: string) => `${SAVED}${id}`;

/** The menu value of a list: a saved view, a filter, or "" for a list outside the menu. */
export const filterValue = (context: ListContext) =>
  context.savedView
    ? savedValue(context.savedView)
    : (listFilters.find(
        (filter) =>
          filter.view === context.view && filter.status === context.status,
      )?.id ?? "");

/** The list that a menu value chooses. A saved view keeps the current scope and search. */
export function chooseFilter(
  context: ListContext,
  value: string,
): ListContext | null {
  if (value.startsWith(SAVED))
    return { ...context, savedView: value.slice(SAVED.length) };
  const filter = listFilters.find((item) => item.id === value);
  return filter
    ? { view: filter.view, status: filter.status, search: context.search }
    : null;
}

/** The pane title: the saved view's name, the filter's label or the view's title. */
export function listTitle(
  context: ListContext,
  views: readonly SavedView[],
  t: (key: string) => string,
) {
  const saved = views.find((view) => view.id === context.savedView);
  if (saved) return saved.name;
  const value = filterValue(context);
  const filter = listFilters.find((item) => item.id === value);
  return t(filter?.labelKey ?? viewTitleKeys[context.view]);
}

type Rules = CreateConversationViewRequest["json"]["filters"]["rules"];

/**
 * The rules that save the current list as a view. Spam, the search text and a saved view
 * have no rule, so those lists cannot be saved (null).
 */
export function viewRules(context: ListContext): Rules | null {
  if (context.status === "spam" || context.savedView || context.search)
    return null;
  if (context.view === "queue")
    return [
      { field: "status", value: "open" },
      { field: "waiting", value: true },
    ];
  const rules: Rules = [];
  if (context.view === "mine") rules.push({ field: "assignee", value: "me" });
  if (context.view === "unassigned")
    rules.push({ field: "assignee", value: "unassigned" });
  if (context.status !== "any")
    rules.push({ field: "status", value: context.status });
  return rules;
}
