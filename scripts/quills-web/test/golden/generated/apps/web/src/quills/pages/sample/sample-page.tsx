import { useTranslation } from "react-i18next";
import { usePortalViewer } from "../../core/use-portal-viewer";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { StateView } from "../../ui/state-view";

export interface SamplePageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}
export function SamplePage(props: SamplePageProps) {
  void props;
  const { t } = useTranslation("quills");
  const viewer = usePortalViewer();
  const portal = usePortalRuntime();
  void viewer;

  // TODO(quills-web): connect generated hooks for getQuillsPublicPortalConfig.
  return (
    <PageFrame
      titleKey="sample.title"
      token="none"
      tokenScope={undefined}
      persistToken={false}
    >
      <StateView
        loading={portal.accessLoading}
        problem={portal.accessProblem}
        onRetry={portal.retryAccess}
      >
        <p>{t("sample.title")}</p>
      </StateView>
    </PageFrame>
  );
}
