import { teamSections, type TeamNavItem, type TeamNavSection } from "./nav";
import { teamHref } from "./team-href";

/** The view path of an address in the teammate app, such as "/triage". The overview is "". */
export const viewPath = (pathname: string, workspaceId: string) =>
  pathname.slice(teamHref(workspaceId).length).replace(/\/$/, "");

/** True when `path` shows the item: the overview only by itself, other views also with sub-paths. */
export const showsItem = (path: string, item: TeamNavItem) =>
  item.path === ""
    ? path === ""
    : path === item.path || path.startsWith(`${item.path}/`);

/** The sections that have views, in rail order. */
export const visibleSections = (sections = teamSections) =>
  sections.filter((section) => section.items.length > 0);

/** The section of a view path. A path outside every view selects the first section. */
export function activeSection(
  path: string,
  sections = teamSections,
): TeamNavSection | undefined {
  const visible = visibleSections(sections);
  return (
    visible.find((section) =>
      [...section.items, ...section.browse].some((item) =>
        showsItem(path, item),
      ),
    ) ?? visible[0]
  );
}
