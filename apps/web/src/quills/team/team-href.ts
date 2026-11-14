/** The address of a teammate app view. `path` is a nav item path such as "/triage". */
export const teamHref = (workspaceId: string, path = "") =>
  `/feedback/${encodeURIComponent(workspaceId)}${path}`;

/**
 * The teammate app address of an old /dashboard/workspace/{id}/quills address,
 * with the same sub-path, search and hash. The path stays encoded. The router
 * matches paths without letter case, so the pattern does too: else the old
 * route would redirect to itself.
 */
export function legacyTeamHref(location: {
  pathname: string;
  searchStr: string;
  hash: string;
}) {
  const path = location.pathname.replace(
    /^\/dashboard\/workspace\/([^/]+)\/quills(?=\/|$)/i,
    "/feedback/$1",
  );
  return `${path}${location.searchStr}${location.hash ? `#${location.hash}` : ""}`;
}
