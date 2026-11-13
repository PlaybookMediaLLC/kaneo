import { portalHref } from "../../core/portal-href";
import { useGetPublicHelpCenter } from "../../hooks/help-center/use-get-public-help-center";
import { useSearchPublicHelpCenter } from "../../hooks/help-center/use-search-public-help-center";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";
import { HelpCenterLocaleContent } from "./parts/help-center-locale-content";

export interface HelpCenterLocalePageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

export function HelpCenterLocalePage(props: HelpCenterLocalePageProps) {
  const portal = usePortalRuntime();
  const { viewer } = portal;
  const locale = (
    [
      "en",
      "de",
      "fr",
      "es",
      "ar",
      "ru",
      "pt-br",
      "zh-cn",
      "zh-tw",
      "nl",
      "pl",
      "th",
      "uk",
    ] as const
  ).find((item) => item === props.params.locale);
  const searchQuery =
    typeof props.search.query === "string" ? props.search.query.trim() : "";
  const home = useGetPublicHelpCenter(
    { param: { workspace: props.workspaceId }, query: { locale } },
    viewer,
  );
  const results = useSearchPublicHelpCenter(
    {
      param: { workspace: props.workspaceId },
      json: { query: searchQuery, locale, limit: 10 },
    },
    viewer,
  );
  const problem = home.error ?? (searchQuery ? results.error : null) ?? null;
  const gated = (meta.audience as string) !== "public";

  return (
    <PageFrame titleKey="help-center.title">
      <StateView
        loading={gated && portal.accessLoading}
        problem={gated ? portal.accessProblem : null}
        onRetry={gated ? portal.retryAccess : undefined}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(props.workspaceId, `hc/${locale}`)}
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
              <HelpCenterLocaleContent
                workspaceId={props.workspaceId}
                locale={locale ?? "en"}
                home={home.data}
                results={results.data}
                searchQuery={searchQuery}
              />
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
