import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  UserAvatar,
} from "../ui/upstream";
import type { TeamNavSection } from "./nav";
import { teamHref } from "./team-href";

export interface IconRailProps {
  workspaceId: string;
  /** The sections with views, in order. */
  sections: readonly TeamNavSection[];
  activeId?: string;
  /** The button that opens the section views on small screens. */
  menu: ReactNode;
}

const item =
  "flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:shadow-xs [&_svg]:size-4";

/** The section icons, "Back to the workspace" and the account. A top bar below md. */
export function IconRail({
  workspaceId,
  sections,
  activeId,
  menu,
}: IconRailProps) {
  const { t } = useTranslation("quills");
  const tip = (label: string, trigger: ReactElement) => (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
  return (
    <TooltipProvider>
      <nav
        aria-label={t("team.navigation")}
        className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5 md:w-12 md:flex-col md:border-0 md:px-0 md:py-2"
      >
        <div className="md:hidden">{menu}</div>
        <ul className="flex items-center gap-1 md:flex-col">
          {sections.map(({ id, labelKey, icon: Icon, items }) => (
            <li key={id}>
              {tip(
                t(labelKey),
                <Link
                  to={teamHref(workspaceId, items[0]?.path)}
                  activeOptions={{ exact: true }}
                  aria-label={t(labelKey)}
                  data-active={id === activeId}
                  className={item}
                >
                  <Icon aria-hidden="true" />
                </Link>,
              )}
            </li>
          ))}
        </ul>
        <div className="ms-auto flex items-center gap-1 md:ms-0 md:mt-auto md:flex-col">
          {tip(
            t("team.back"),
            <Link
              to="/dashboard/workspace/$workspaceId"
              params={{ workspaceId }}
              aria-label={t("team.back")}
              className={item}
            >
              <ArrowLeft aria-hidden="true" />
            </Link>,
          )}
          <UserAvatar />
        </div>
      </nav>
    </TooltipProvider>
  );
}
