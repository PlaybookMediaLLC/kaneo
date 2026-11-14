import {
  ChartColumn,
  Headset,
  Lightbulb,
  type LucideIcon,
  Megaphone,
  Settings,
} from "lucide-react";
import type { GetTeamCountsResponse } from "../api/team/get-team-counts";

/** A value of the team counts route (`getQuillsTeamCounts`). */
export type TeamCountKey = keyof GetTeamCountsResponse;

export interface TeamNavItem {
  /** The path after /feedback/{id}. The overview is "". */
  path: string;
  labelKey: string;
  /** The count that the item shows. */
  countKey?: TeamCountKey;
}

export interface TeamNavSection {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  /** The views of the section, in work order. The shell hides a section without views. */
  items: readonly TeamNavItem[];
  /** The collapsible "Browse" group. The shell hides an empty group. */
  browse: readonly TeamNavItem[];
}

// The sections of RFC 0004 D4. Lanes add their views here; the rail and the
// section column show them without other changes.
export const teamSections: readonly TeamNavSection[] = [
  {
    id: "support",
    labelKey: "team.sections.support",
    icon: Headset,
    items: [
      {
        path: "/conversations/mine",
        labelKey: "team-conversations.views.mine",
        countKey: "myConversations",
      },
      {
        path: "/conversations/unassigned",
        labelKey: "team-conversations.views.unassigned",
        countKey: "unassignedConversations",
      },
      {
        path: "/conversations/all",
        labelKey: "team-conversations.views.all",
        countKey: "openConversations",
      },
      {
        path: "/tickets",
        labelKey: "team-tickets.title",
        countKey: "openTickets",
      },
      { path: "/my-tickets", labelKey: "team-tickets.mine" },
    ],
    browse: [],
  },
  {
    id: "feedback",
    labelKey: "team.sections.feedback",
    icon: Lightbulb,
    items: [
      { path: "", labelKey: "team.nav.home" },
      { path: "/posts", labelKey: "team-posts.nav" },
      { path: "/triage", labelKey: "team-triage.nav" },
      {
        path: "/duplicates",
        labelKey: "duplicates.nav",
        countKey: "pendingDuplicates",
      },
      {
        path: "/autopilot",
        labelKey: "autopilot.nav",
        countKey: "pendingSignals",
      },
    ],
    browse: [],
  },
  {
    id: "insights",
    labelKey: "team.sections.insights",
    icon: ChartColumn,
    items: [
      { path: "/insights", labelKey: "insights.nav" },
      { path: "/surveys", labelKey: "surveys.title" },
    ],
    browse: [],
  },
  {
    id: "changelog",
    labelKey: "team.sections.changelog",
    icon: Megaphone,
    items: [{ path: "/changelog", labelKey: "team-changelog.nav" }],
    browse: [],
  },
  {
    id: "settings",
    labelKey: "team.sections.settings",
    icon: Settings,
    items: [{ path: "/boards", labelKey: "boards.nav" }],
    browse: [],
  },
];
