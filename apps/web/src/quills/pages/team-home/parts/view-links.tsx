import { useTranslation } from "react-i18next";
import type { GetTeamCountsResponse } from "../../../api/team/get-team-counts";
import { teamSections } from "../../../team/nav";
import { SidebarItem } from "../../../team/sidebar-item";

export interface ViewLinksProps {
  workspaceId: string;
  /** The nav counts. A missing count shows nothing. */
  counts?: Partial<GetTeamCountsResponse>;
}

/** Every view of the teammate app by sidebar section, each with its count. */
export function ViewLinks({ workspaceId, counts }: ViewLinksProps) {
  const { t } = useTranslation("quills");
  return (
    <nav
      aria-label={t("team.home.views")}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      {teamSections(workspaceId, counts).map((section) => {
        const views = section.items.filter((item) => item.id !== "overview");
        return (
          <section
            key={section.id}
            aria-label={t(section.labelKey)}
            className="rounded-lg border border-border p-2"
          >
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t(section.labelKey)}
            </p>
            <ul className="grid gap-0.5">
              {views.map((item) => (
                <li key={item.id}>
                  <SidebarItem item={item} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
