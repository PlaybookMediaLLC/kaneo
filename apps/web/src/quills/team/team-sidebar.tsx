import { brandText } from "@kaneo/branding";
import { Link } from "@tanstack/react-router";
import { LifeBuoy, SquarePen } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { GetTeamCountsResponse } from "../api/team/get-team-counts";
import { IconButton } from "../ui/inbox/icon-button";
import { UserAvatar } from "../ui/upstream";
import { DesktopNotifications } from "./desktop-notifications";
import { teamSections } from "./nav";
import { NotificationsButton } from "./notifications-button";
import { SidebarItem } from "./sidebar-item";
import { teamHref } from "./team-href";
import {
  WorkspaceSwitcher,
  type WorkspaceSwitcherProps,
} from "./workspace-switcher";

export interface TeamSidebarProps extends Pick<
  WorkspaceSwitcherProps,
  "workspaceName" | "workspaceLogo" | "workspaceRole"
> {
  workspaceId: string;
  counts?: GetTeamCountsResponse;
  /** Runs after a view is chosen, for example to close the sheet on small screens. */
  onNavigate?: () => void;
}

/**
 * The one sidebar of the teammate app (design section 1): the workspace, New request and
 * the bell, the Conversations, Requests and Workspace views, desktop notifications and Support.
 */
export function TeamSidebar({
  workspaceId,
  counts,
  onNavigate,
  ...workspace
}: TeamSidebarProps) {
  const { t } = useTranslation("quills");
  const id = useId();
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 px-3 py-3">
      <div className="flex items-center gap-0.5">
        <WorkspaceSwitcher workspaceId={workspaceId} {...workspace} />
        <IconButton
          label={t("team.newRequest")}
          render={
            <Link
              to={teamHref(workspaceId, "/posts")}
              search={{ new: true }}
              onClick={onNavigate}
            />
          }
        >
          <SquarePen aria-hidden="true" />
        </IconButton>
        <NotificationsButton
          workspaceId={workspaceId}
          onNavigate={onNavigate}
        />
      </div>
      <nav
        aria-label={t("team.navigation")}
        className="-mx-1 grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-1"
      >
        {teamSections(workspaceId, counts).map((section) => (
          <div key={section.id} className="grid gap-1">
            <p
              id={`${id}-${section.id}`}
              className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {t(section.labelKey)}
            </p>
            <ul
              aria-labelledby={`${id}-${section.id}`}
              className="grid grid-cols-1 gap-0.5"
            >
              {section.items.map((item) => (
                <li key={item.id}>
                  <SidebarItem item={item} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <DesktopNotifications />
      <div className="flex items-center gap-2">
        <a
          href={brandText("https://kaneo.app/docs")}
          target="_blank"
          rel="noreferrer"
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-sm text-sidebar-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LifeBuoy aria-hidden="true" className="size-4" />
          {t("team.support")}
        </a>
        <UserAvatar />
      </div>
    </div>
  );
}
