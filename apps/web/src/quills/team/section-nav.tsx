import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TeamCountKey, TeamNavItem, TeamNavSection } from "./nav";
import { teamHref } from "./team-href";

export interface SectionNavProps {
  workspaceId: string;
  workspaceName?: string;
  section: TeamNavSection;
  counts?: Partial<Record<TeamCountKey, number>>;
  /** Runs after a view is chosen, for example to close the sheet on small screens. */
  onNavigate?: () => void;
}

const link =
  "flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-background aria-[current=page]:font-medium aria-[current=page]:text-foreground";

/** The views of the current section with their counts, then the collapsible "Browse" group. */
export function SectionNav({
  workspaceId,
  workspaceName,
  section,
  counts,
  onNavigate,
}: SectionNavProps) {
  const { t } = useTranslation("quills");
  const view = (item: TeamNavItem) => {
    const count = item.countKey ? counts?.[item.countKey] : undefined;
    return (
      <li key={item.path}>
        <Link
          to={teamHref(workspaceId, item.path)}
          activeOptions={{ exact: item.path === "" }}
          onClick={onNavigate}
          className={link}
        >
          <span className="truncate">{t(item.labelKey)}</span>{" "}
          {count === undefined ? null : (
            <span className="ms-auto text-xs tabular-nums">{count}</span>
          )}
        </Link>
      </li>
    );
  };
  return (
    <div className="flex flex-col gap-3 px-2 py-3">
      {workspaceName ? (
        <p className="truncate px-2 text-sm font-semibold">{workspaceName}</p>
      ) : null}
      <nav
        aria-label={t("team.views", { section: t(section.labelKey) })}
        className="flex flex-col gap-3"
      >
        <ul className="grid gap-0.5">{section.items.map(view)}</ul>
        {section.browse.length ? (
          <details open className="group">
            <summary className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 transition-transform group-open:rotate-90"
              />
              {t("team.browse")}
            </summary>
            <ul className="grid gap-0.5">{section.browse.map(view)}</ul>
          </details>
        ) : null}
      </nav>
    </div>
  );
}
