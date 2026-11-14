import {
  ChartColumn,
  ClipboardList,
  Copy,
  Inbox,
  LayoutGrid,
  ListChecks,
  Megaphone,
  MessagesSquare,
  Settings,
  Sparkles,
  Ticket,
  UserRound,
  Zap,
} from "lucide-react";
import type { TeamCountKey, TeamNavItem } from "./nav";

/** A sidebar view of the teammate app, before the workspace and the counts fill it in. */
export type TeamView = Omit<TeamNavItem, "to" | "count"> & {
  /** The path after /feedback/{id}. The overview is "". */
  path: string;
  countKey?: TeamCountKey;
};

// The views of design section 1. Lanes add their views here.
export const conversationViews: readonly TeamView[] = [
  {
    id: "queue",
    path: "/conversations/queue",
    labelKey: "team-conversations.views.queue",
    icon: Zap,
    countKey: "queueConversations",
    attention: true,
  },
  {
    id: "open",
    path: "/conversations/open",
    labelKey: "team-conversations.views.open",
    icon: Inbox,
    countKey: "openConversations",
  },
  {
    id: "all",
    path: "/conversations/all",
    labelKey: "team-conversations.views.all",
    icon: MessagesSquare,
  },
  {
    id: "tickets",
    path: "/tickets",
    labelKey: "team-tickets.title",
    icon: Ticket,
    countKey: "openTickets",
  },
  {
    id: "my-tickets",
    path: "/my-tickets",
    labelKey: "team-tickets.mine",
    icon: UserRound,
  },
];
export const workspaceViews: readonly TeamView[] = [
  {
    id: "overview",
    path: "",
    labelKey: "team.nav.home",
    icon: LayoutGrid,
    exact: true,
  },
  {
    id: "changelog",
    path: "/changelog",
    labelKey: "team-changelog.nav",
    icon: Megaphone,
  },
  {
    id: "triage",
    path: "/triage",
    labelKey: "team-triage.nav",
    icon: ListChecks,
  },
  {
    id: "duplicates",
    path: "/duplicates",
    labelKey: "duplicates.nav",
    icon: Copy,
    countKey: "pendingDuplicates",
  },
  {
    id: "autopilot",
    path: "/autopilot",
    labelKey: "autopilot.nav",
    icon: Sparkles,
    countKey: "pendingSignals",
  },
  {
    id: "insights",
    path: "/insights",
    labelKey: "insights.nav",
    icon: ChartColumn,
  },
  {
    id: "surveys",
    path: "/surveys",
    labelKey: "surveys.title",
    icon: ClipboardList,
  },
  {
    id: "settings",
    path: "/boards",
    labelKey: "team.nav.settings",
    icon: Settings,
  },
];
