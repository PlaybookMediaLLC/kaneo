import { useLocation } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGetTeamCounts } from "../hooks/team/use-get-team-counts";
import {
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetPanel,
  SheetTitle,
  SheetTrigger,
} from "../ui/upstream";
import { activeSection, viewPath, visibleSections } from "./active-nav";
import { IconRail } from "./icon-rail";
import { useTeamRuntime } from "./runtime";
import { SectionNav } from "./section-nav";

export interface TeamShellProps {
  workspaceId: string;
  workspaceName?: string;
  children: ReactNode;
}

/**
 * The teammate app layout (RFC 0004 D2): the icon rail, the views of the current section and
 * the main panel. Below md the rail is a top bar and the views open in a sheet. An open item
 * (DetailLayout) hides the views column, because its compact list takes that place.
 */
export function TeamShell({
  workspaceId,
  workspaceName,
  children,
}: TeamShellProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  // The counts are only labels: a refused or failed request shows none.
  const counts = useGetTeamCounts({ param: { workspaceId } }, team.viewer);
  const pathname = useLocation({ select: (location) => location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  const section = activeSection(viewPath(pathname, workspaceId));
  const views = (onNavigate?: () => void) =>
    section ? (
      <SectionNav
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        section={section}
        counts={counts.data}
        onNavigate={onNavigate}
      />
    ) : null;
  return (
    <div className="group/shell flex h-svh min-h-0 flex-col bg-muted md:flex-row">
      <IconRail
        workspaceId={workspaceId}
        sections={visibleSections()}
        activeId={section?.id}
        menu={
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger
              render={<Button variant="ghost" size="icon-sm" />}
              aria-label={t("team.menu")}
            >
              <Menu aria-hidden="true" />
            </SheetTrigger>
            <SheetContent side="left">
              <SheetHeader>
                <SheetTitle>{section ? t(section.labelKey) : null}</SheetTitle>
              </SheetHeader>
              <SheetPanel>{views(() => setMenuOpen(false))}</SheetPanel>
            </SheetContent>
          </Sheet>
        }
      />
      <div className="hidden w-56 shrink-0 overflow-y-auto md:block md:group-has-[[data-slot=detail-layout]]/shell:hidden">
        {views()}
      </div>
      <main className="min-h-0 min-w-0 flex-1 overflow-auto bg-background md:my-2 md:me-2 md:rounded-xl md:border md:border-border md:shadow-xs">
        {children}
      </main>
    </div>
  );
}
