import {
  Inbox,
  type LucideIcon,
  Map as MapIcon,
  Share2,
  Users,
} from "lucide-react";
import type { GetTeamCountsResponse } from "../api/team/get-team-counts";
import { portalHref } from "../core/portal-href";
import { statusProgress } from "../core/status-progress";
import { conversationViews, workspaceViews, type TeamView } from "./nav-views";
import { teamHref } from "./team-href";

/** A number of the team counts route (`getQuillsTeamCounts`). */
export type TeamCountKey = {
  [
    Key in keyof GetTeamCountsResponse
  ]: GetTeamCountsResponse[Key] extends number ? Key : never;
}[keyof GetTeamCountsResponse];

export interface TeamNavItem {
  id: string;
  /** A translation key, or `label` for a workspace value such as a status name. */
  labelKey?: string;
  label?: string;
  icon?: LucideIcon;
  /** The status icon of a Requests item. */
  status?: { color: string; progress: number };
  /** The address. `search` must match too for the item to be current. */
  to: string;
  search?: Record<string, string>;
  /** Current only on this exact address, such as the overview. */
  exact?: boolean;
  /** Opens in a new tab, such as the public portal. */
  newTab?: boolean;
  /** Copies the address as a full link instead of opening it. */
  copy?: boolean;
  count?: number;
  /** Shows the count in the orange filled badge when it is above zero. */
  attention?: boolean;
}

export interface TeamNavSection {
  id: string;
  labelKey: string;
  items: readonly TeamNavItem[];
}

/**
 * The sidebar sections of a workspace. The Requests items come from the open post statuses
 * of the counts, in status order; the first has the orange badge when it has posts.
 */
export function teamSections(
  workspaceId: string,
  counts?: Partial<GetTeamCountsResponse>,
): readonly TeamNavSection[] {
  const view = ({ path, countKey, ...item }: TeamView): TeamNavItem => ({
    ...item,
    to: teamHref(workspaceId, path),
    count: countKey ? counts?.[countKey] : undefined,
  });
  const statuses = counts?.postStatuses ?? [];
  const open = statuses.map((status) => ({ ...status, category: "active" }));
  const posts = teamHref(workspaceId, "/posts");
  const [overview, changelog, ...extras] = workspaceViews.map(view);
  return [
    {
      id: "conversations",
      labelKey: "team.sections.conversations",
      items: conversationViews.map(view),
    },
    {
      id: "requests",
      labelKey: "team.sections.requests",
      items: [
        ...statuses.map((status, index) => ({
          id: `status-${status.id}`,
          label: status.name,
          status: {
            color: status.color,
            progress: statusProgress(open, status.id),
          },
          to: posts,
          search: { statusId: status.id },
          count: status.count,
          attention: index === 0,
        })),
        {
          id: "all-requests",
          labelKey: "team.nav.allRequests",
          icon: Inbox,
          to: posts,
          search: { status: "all" },
        },
      ],
    },
    {
      id: "workspace",
      labelKey: "team.sections.workspace",
      items: [
        overview!,
        {
          id: "roadmap",
          labelKey: "team.nav.roadmap",
          icon: MapIcon,
          to: portalHref(workspaceId, "roadmap"),
          newTab: true,
        },
        changelog!,
        {
          id: "members",
          labelKey: "team.nav.members",
          icon: Users,
          to: `/dashboard/workspace/${encodeURIComponent(workspaceId)}/members`,
        },
        {
          id: "share",
          labelKey: "team.nav.share",
          icon: Share2,
          to: portalHref(workspaceId),
          copy: true,
        },
        ...extras,
      ],
    },
  ];
}
