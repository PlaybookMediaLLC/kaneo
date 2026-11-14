import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { visibleSections } from "../../../team/active-nav";
import type { TeamCountKey } from "../../../team/nav";
import { teamHref } from "../../../team/team-href";

export interface ViewLinksProps {
  workspaceId: string;
  /** The nav counts. A missing count shows nothing. */
  counts?: Partial<Record<TeamCountKey, number>>;
}

/** Every view of the teammate app by section, each with its count. */
export function ViewLinks({ workspaceId, counts }: ViewLinksProps) {
  const { t } = useTranslation("quills");
  return (
    <nav
      aria-label={t("team.home.views")}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {visibleSections().map((section) => {
        const views = section.items.filter((item) => item.path !== "");
        const Icon = section.icon;
        return views.length ? (
          <section
            key={section.id}
            aria-label={t(section.labelKey)}
            className="rounded-lg border border-border p-2"
          >
            <p className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
              <Icon aria-hidden="true" className="size-3.5" />
              {t(section.labelKey)}
            </p>
            <ul className="grid gap-0.5">
              {views.map((item) => {
                const count = item.countKey
                  ? counts?.[item.countKey]
                  : undefined;
                return (
                  <li key={item.path}>
                    <Link
                      to={teamHref(workspaceId, item.path)}
                      className="flex h-8 items-center gap-2 rounded-md px-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="truncate">{t(item.labelKey)}</span>{" "}
                      {count === undefined ? null : (
                        <span className="ms-auto tabular-nums text-muted-foreground">
                          {count}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null;
      })}
    </nav>
  );
}
