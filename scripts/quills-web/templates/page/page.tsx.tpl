{{TOKEN_IMPORT}}import { useTranslation } from "react-i18next";
import { usePortalViewer } from "../../core/use-portal-viewer";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { StateView } from "../../ui/state-view";
{{META_IMPORT}}
export interface {{COMPONENT}}PageProps { workspaceId: string; params: Record<string, string>; search: Record<string, unknown>; }
export function {{COMPONENT}}Page(props: {{COMPONENT}}PageProps) {
  void props;
  const { t } = useTranslation("quills");
  const viewer = usePortalViewer();
  const portal = usePortalRuntime();
  void viewer;
  {{TOKEN_SCOPE_DECL}}
  {{TOKEN_STATE}}
  {{TOKEN_VOID}}
  // TODO(quills-web): connect generated hooks for {{OPERATIONS}}.
  return <PageFrame titleKey={{TITLE_KEY}} token={{TOKEN_MODE}} tokenScope={{{TOKEN_SCOPE}}} persistToken={{{PERSIST_TOKEN}}}>
    <StateView loading={portal.accessLoading} problem={portal.accessProblem} onRetry={portal.retryAccess}><p>{t({{TITLE_KEY}})}</p></StateView>
  </PageFrame>;
}
