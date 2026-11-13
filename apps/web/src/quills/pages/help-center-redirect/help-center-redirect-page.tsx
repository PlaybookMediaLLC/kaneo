import { Navigate } from "@tanstack/react-router";
import { portalHref } from "../../core/portal-href";
import { useResolvePublicHelpCenterRedirect } from "../../hooks/help-center/use-resolve-public-help-center-redirect";
import { usePortalRuntime } from "../../portal/runtime";
import { PageFrame } from "../../ui/page-frame";
import { PortalGate } from "../../ui/portal-gate";
import { StateView } from "../../ui/state-view";
import { meta } from "./meta";

export interface HelpCenterRedirectPageProps {
  workspaceId: string;
  params: Record<string, string>;
  search: Record<string, unknown>;
}

export function HelpCenterRedirectPage(props: HelpCenterRedirectPageProps) {
  const portal = usePortalRuntime();
  const { viewer } = portal;
  const legacyPath = `/${["hc", props.params._splat].filter(Boolean).join("/")}`;
  const redirect = useResolvePublicHelpCenterRedirect(
    { param: { workspace: props.workspaceId }, query: { path: legacyPath } },
    viewer,
  );
  const missing =
    redirect.data?.target === null ? { kind: "notFound" as const } : null;
  const gated = (meta.audience as string) !== "public";

  return (
    <PageFrame titleKey="help-center.legacyTitle">
      <StateView
        loading={gated && portal.accessLoading}
        problem={gated ? portal.accessProblem : null}
        onRetry={gated ? portal.retryAccess : undefined}
      >
        <PortalGate
          workspaceId={props.workspaceId}
          currentPath={portalHref(props.workspaceId, legacyPath)}
          audience={meta.audience}
          portalEnabled
          accessGranted={portal.access?.granted ?? false}
          signedIn={portal.viewer.kind === "user"}
        >
          <StateView
            loading={redirect.isLoading}
            problem={redirect.error ?? missing}
            onRetry={() => {
              void redirect.refetch();
            }}
          >
            {redirect.data?.target ? (
              <Navigate
                to={portalHref(props.workspaceId, redirect.data.target)}
                replace
              />
            ) : null}
          </StateView>
        </PortalGate>
      </StateView>
    </PageFrame>
  );
}
