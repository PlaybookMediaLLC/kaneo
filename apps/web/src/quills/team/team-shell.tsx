import { Menu } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetTeamCounts } from "../hooks/team/use-get-team-counts";
import {
  Button,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "../ui/upstream";
import { useTeamRuntime } from "./runtime";
import { TeamSidebar, type TeamSidebarProps } from "./team-sidebar";

export type TeamShellProps = Omit<TeamSidebarProps, "counts" | "onNavigate"> & {
  children: ReactNode;
};

/**
 * The teammate app layout (RFC 0004 revision 2): one light sidebar and the white main
 * surface. Below md the sidebar opens as a sheet from a menu button in a top bar.
 */
export function TeamShell({ children, ...sidebar }: TeamShellProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  // The counts are only labels: a refused or failed request shows none.
  const counts = useGetTeamCounts(
    { param: { workspaceId: sidebar.workspaceId } },
    team.viewer,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex h-svh min-h-0 w-full flex-col bg-sidebar md:flex-row">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 md:hidden">
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger
            render={<Button variant="ghost" size="icon-sm" />}
            aria-label={t("team.menu")}
          >
            <Menu aria-hidden="true" />
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-75 max-w-[85vw] bg-sidebar p-0"
          >
            <SheetTitle className="sr-only">{t("team.navigation")}</SheetTitle>
            <TeamSidebar
              {...sidebar}
              counts={counts.data}
              onNavigate={() => setMenuOpen(false)}
            />
          </SheetContent>
        </Sheet>
        <p className="truncate text-sm font-semibold">
          {sidebar.workspaceName}
        </p>
      </div>
      <div className="hidden w-75 shrink-0 md:flex">
        <TeamSidebar {...sidebar} counts={counts.data} />
      </div>
      <main className="min-h-0 min-w-0 flex-1 overflow-auto bg-background md:my-2 md:me-2 md:rounded-xl md:border md:border-border md:shadow-xs">
        {children}
      </main>
    </div>
  );
}
