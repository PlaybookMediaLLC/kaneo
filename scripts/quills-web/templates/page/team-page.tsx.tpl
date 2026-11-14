import { useTranslation } from "react-i18next";
import { useTeamRuntime } from "../../team/runtime";
import { TeamStateView } from "../../team/team-state-view";
import { PageFrame } from "../../ui/page-frame";
export interface {{COMPONENT}}PageProps { workspaceId: string; params: Record<string, string>; search: Record<string, unknown>; }
export function {{COMPONENT}}Page(props: {{COMPONENT}}PageProps) {
  void props;
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  void team;
  // TODO(quills-web): connect generated hooks for {{OPERATIONS}} with team.viewer, and pass their state to TeamStateView.
  return <PageFrame titleKey={{TITLE_KEY}} landmark={false}>
    <TeamStateView loading={false} problem={null}><p>{t({{TITLE_KEY}})}</p></TeamStateView>
  </PageFrame>;
}
