export interface TeamNavEntry {
  /** The path after /dashboard/workspace/{id}/quills. The overview is "". */
  path: string;
  labelKey: string;
}

// The team shell navigation, in work order: review new feedback first, then plan and announce.
export const teamNavigation: readonly TeamNavEntry[] = [
  { path: "", labelKey: "team.nav.home" },
  { path: "/triage", labelKey: "team-triage.nav" },
  { path: "/autopilot", labelKey: "autopilot.nav" },
  { path: "/duplicates", labelKey: "duplicates.nav" },
  { path: "/insights", labelKey: "insights.nav" },
  { path: "/surveys", labelKey: "surveys.title" },
  { path: "/changelog", labelKey: "team-changelog.nav" },
  { path: "/boards", labelKey: "boards.nav" },
];
