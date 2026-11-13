import { HelpNavigation } from "../../ui/help-navigation";
import { portalHref } from "../../core/portal-href";
import { useGetPublicHelpCenter } from "../../hooks/help-center/use-get-public-help-center";
import { useSearchPublicHelpCenter } from "../../hooks/help-center/use-search-public-help-center";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";
import { HelpCenterContent } from "./parts/help-center-content";

export interface HelpCenterPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

export function HelpCenterPage(props: HelpCenterPageProps) {
  const portal = usePortalRuntime();
  const { viewer } = portal;
  const searchQuery =
    typeof props.search.query === "string" ? props.search.query.trim() : "";
  const home = useGetPublicHelpCenter(
    { param: { workspace: props.workspaceId }, query: {} },
    viewer,
  );
  const results = useSearchPublicHelpCenter(
    {
      param: { workspace: props.workspaceId },
      json: { query: searchQuery, limit: 10 },
    },
    viewer,
  );
  const problem = home.error ?? (searchQuery ? results.error : null) ?? null;
  const gated = (meta.audience as string) !== "public";

  return (
    <PageFrame
      titleKey="help-center.title"
      displayTitle={home.data?.homepageTitle}
    >
      <StateView
        loading={gated && portal.accessLoading}
        problem={gated ? portal.accessProblem : null}
        onRetry={gated ? portal.retryAccess : undefined}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(props.workspaceId, "hc")}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={
              home.isLoading || (searchQuery ? results.isLoading : false)
            }
            problem={problem}
            onRetry={() => {
              void home.refetch();
              if (searchQuery) void results.refetch();
            }}
          >
            {home.data ? (
              <div className="grid items-start gap-8 md:grid-cols-[220px_minmax(0,1fr)]">
                <HelpNavigation
                  workspaceId={props.workspaceId}
                  categories={home.data.categories}
                  locale={props.params.locale ?? "en"}
                />
                <div className="min-w-0">
                  <HelpCenterContent
                    workspaceId={props.workspaceId}
                    home={home.data}
                    results={results.data}
                    searchQuery={searchQuery}
                  />
                </div>
              </div>
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
