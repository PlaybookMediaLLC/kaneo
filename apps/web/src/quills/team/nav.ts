export interface TeamNavEntry {
  /** The path after /dashboard/workspace/{id}/quills. The overview is "". */
  path: string;
  labelKey: string;
}

// The team shell navigation. A Wave 1 lane appends one entry for each teammate page.
export const teamNavigation: readonly TeamNavEntry[] = [
  { path: "", labelKey: "team.nav.home" },
  { path: "/duplicates", labelKey: "duplicates.nav" },
  { path: "/insights", labelKey: "insights.nav" },
  { path: "/surveys", labelKey: "surveys.title" },
  { path: "/autopilot", labelKey: "autopilot.nav" },
  // RFC 0003 lane L5.
  { path: "/changelog", labelKey: "team-changelog.nav" },
  // RFC 0003, lane L3.
  { path: "/triage", labelKey: "team-triage.nav" },
];
