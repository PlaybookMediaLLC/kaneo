import type { ReactNode } from "react";
import { Outlet, useParams } from "@tanstack/react-router";
import type { PortalBranding } from "../core/types";
import { usePortalViewer } from "../core/use-portal-viewer";
import { useEvaluateMyPortalAccess } from "../hooks/portal/use-evaluate-my-portal-access";
import { useGetPublicPortalConfig } from "../hooks/portal/use-get-public-portal-config";
import { PortalShell } from "../ui/portal-shell";
import { StateView } from "../ui/state-view";
import { PortalRuntimeProvider } from "./runtime";

export interface PortalLayoutProps {
  workspaceName: string;
  branding: PortalBranding;
  children: ReactNode;
  actions?: ReactNode;
}

export function PortalLayout({
  workspaceName,
  branding,
  children,
  actions,
}: PortalLayoutProps) {
  return (
    <PortalShell
      workspaceName={workspaceName}
      branding={branding}
      actions={actions}
    >
      {children}
    </PortalShell>
  );
}

export function PortalRoute() {
  const params = useParams({ strict: false });
  const workspaceId = String(params.workspaceId);
  const viewer = usePortalViewer();
  const input = { param: { workspace: workspaceId } };
  const config = useGetPublicPortalConfig(input, viewer);
  const access = useEvaluateMyPortalAccess(input, viewer);

  return (
    <StateView
      loading={config.isLoading}
      problem={config.error ?? null}
      onRetry={() => void config.refetch()}
    >
      {config.data ? (
        <PortalRuntimeProvider
          value={{
            config: config.data,
            viewer,
            access: access.data ?? null,
            accessLoading: access.isLoading,
            accessProblem: access.error ?? null,
            retryAccess: () => void access.refetch(),
          }}
        >
          <PortalLayout
            workspaceName={config.data.name}
            branding={config.data.branding}
          >
            <Outlet />
          </PortalLayout>
        </PortalRuntimeProvider>
      ) : null}
    </StateView>
  );
}
