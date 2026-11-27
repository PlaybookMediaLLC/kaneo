import { useLocation } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { type ReactNode, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetTeamCounts } from "../hooks/team/use-get-team-counts";
import { IconButton } from "../ui/inbox/icon-button";
import {
  cn,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "../ui/upstream";
import { AppBadge } from "./app-badge";
import { useFavorites } from "./favorites";
import { TeamHeaderContext } from "./header-context";
import { useTeamRuntime } from "./runtime";
import { SettingsSidebar } from "./settings-sidebar";
import { shellMode } from "./shell-mode";
import { shellSection } from "./shell-section";
import { TeamRail, type TeamRailProps } from "./team-rail";
import { TeamSidebar } from "./team-sidebar";

export type TeamShellProps = Omit<
  TeamRailProps,
  "counts" | "onNavigate" | "mode" | "section"
> & {
  children: ReactNode;
};

/**
 * The teammate app layout (RFC 0004 revision 2): the section rail, the light sidebar of the
 * section and the white main surface. Below md the rail and the sidebar open as a sheet from a
 * menu button in a top bar. The path picks the sidebar: the app, the settings or none (settings
 * spec 1.2).
 */
export function TeamShell({ children, ...rail }: TeamShellProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const mode = useLocation({
    select: (location) => shellMode(location.pathname),
  });
  const section = useLocation({
    select: (location) => shellSection(location.pathname),
  });
  // The starred address keeps the search, so a filtered view stars as itself.
  const path = useLocation({
    select: (location) => location.pathname + location.searchStr,
  });
  const [favorites, toggleFavorite] = useFavorites(rail.workspaceId);
  const sectionLabels = {
    conversations: t("team.sections.conversations"),
    requests: t("team.sections.requests"),
    workspace: t("team.sections.workspace"),
  };
  const header =
    mode === "app"
      ? {
          section: sectionLabels[section],
          favorite: favorites.some((item) => item.path === path),
          onFavorite: (title: string) => toggleFavorite(path, title),
        }
      : null;
  // The 95% scale and the icon stroke in index.css match this attribute on html.
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-quills-shell", "");
    return () => document.documentElement.removeAttribute("data-quills-shell");
  }, []);
  // The counts are only labels: a refused or failed request shows none.
  const counts = useGetTeamCounts(
    { param: { workspaceId: mode === "app" ? rail.workspaceId : "" } },
    team.viewer,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const nav = (onNavigate?: () => void) => (
    <>
      <TeamRail
        {...rail}
        mode={mode}
        section={section}
        counts={counts.data}
        onNavigate={onNavigate}
      />
      <div className="flex w-64 min-w-0">
        {mode === "settings" ? (
          <SettingsSidebar
            workspaceId={rail.workspaceId}
            onNavigate={onNavigate}
          />
        ) : (
          <TeamSidebar
            workspaceId={rail.workspaceId}
            section={section}
            counts={counts.data}
            favorites={favorites}
            onNavigate={onNavigate}
          />
        )}
      </div>
    </>
  );
  return (
    <div className="flex h-svh min-h-0 w-full flex-col bg-sidebar md:flex-row">
      <AppBadge workspaceId={rail.workspaceId} viewer={team.viewer} quills />
      {mode === "focus" ? null : (
        <>
          <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 md:hidden">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger render={<IconButton label={t("team.menu")} />}>
                <Menu aria-hidden="true" />
              </SheetTrigger>
              <SheetContent
                side="left"
                showCloseButton={false}
                className="w-auto max-w-[90vw] flex-row bg-sidebar p-0"
              >
                <SheetTitle className="sr-only">
                  {t(
                    mode === "settings"
                      ? "settings.navigation"
                      : "team.navigation",
                  )}
                </SheetTitle>
                {menuOpen ? nav(() => setMenuOpen(false)) : null}
              </SheetContent>
            </Sheet>
            <p className="truncate text-sm font-semibold">
              {rail.workspaceName}
            </p>
          </div>
          <div className="hidden shrink-0 md:flex">{nav()}</div>
        </>
      )}
      <main
        className={cn(
          "relative min-h-0 min-w-0 flex-1 overflow-auto bg-background",
          mode !== "focus" &&
            "md:my-2 md:me-2 md:rounded-xl md:border md:border-border md:shadow-xs",
        )}
      >
        <TeamHeaderContext.Provider value={header}>
          {children}
        </TeamHeaderContext.Provider>
      </main>
    </div>
  );
}
