import { portalHref } from "../../core/portal-href";
import { useGetPublicStatusPage } from "../../hooks/status/use-get-public-status-page";
import { useGetPublicStatusUptime } from "../../hooks/status/use-get-public-status-uptime";
import { useListPublicStatusHistory } from "../../hooks/status/use-list-public-status-history";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";
import { StatusContent } from "./parts/status-content";

export interface StatusPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

export function StatusPage(props: StatusPageProps) {
  const portal = usePortalRuntime();
  const { viewer } = portal;
  const page = useGetPublicStatusPage(
    { param: { workspace: props.workspaceId } },
    viewer,
  );
  const componentIds = [
    ...(page.data?.groups.flatMap((group) => group.components) ?? []),
    ...(page.data?.ungroupedComponents ?? []),
  ]
    .filter((component) => component.showUptime)
    .map((component) => component.id);
  const uptime = useGetPublicStatusUptime(
    {
      param: { workspace: props.workspaceId },
      query: { componentIds: componentIds.join(","), windowDays: "90" },
    },
    viewer,
  );
  const history = useListPublicStatusHistory(
    {
      param: { workspace: page.data ? props.workspaceId : "" },
      query: { before: page.data?.recentWindow.start, limit: "20" },
    },
    viewer,
  );
  const incidents = history.data?.pages.flatMap((item) => item.items) ?? [];
  const problem = page.error ?? uptime.error ?? history.error ?? null;
  const gated = (meta.audience as string) !== "public";

  return (
    <PageFrame titleKey="status.title">
      <StateView
        loading={gated && portal.accessLoading}
        problem={gated ? portal.accessProblem : null}
        onRetry={gated ? portal.retryAccess : undefined}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(props.workspaceId, "status")}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={page.isLoading || uptime.isLoading || history.isLoading}
            problem={problem}
            onRetry={() => {
              void page.refetch();
              void uptime.refetch();
              void history.refetch();
            }}
          >
            {page.data ? (
              <StatusContent
                workspaceId={props.workspaceId}
                page={page.data}
                uptime={uptime.data}
                incidents={incidents}
                hasMore={history.hasNextPage}
                loadingMore={history.isFetchingNextPage}
                onLoadMore={() => {
                  void history.fetchNextPage();
                }}
              />
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
