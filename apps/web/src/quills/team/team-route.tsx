import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { usePortalViewer } from "../core/use-portal-viewer";
import { StateView } from "../ui/state-view";
import { useWorkspacePermission, WorkspaceLayout } from "../ui/upstream";
import { TeamRuntimeProvider } from "./runtime";
import { isOtherQuillsScope } from "./team-cache";
import { TeamShell } from "./team-shell";

// The layout of every teammate page: the app header, the team navigation and the page.
export function TeamRoute() {
  const { t } = useTranslation("quills");
  const workspaceId = useParams({
    strict: false,
    select: (params) =>
      "workspaceId" in params ? String(params.workspaceId) : "",
  });
  const viewer = usePortalViewer();
  const permission = useWorkspacePermission();
  const queryClient = useQueryClient();
  const userId = viewer.kind === "user" ? viewer.id : "";

  // A workspace or user switch must not keep the other scope's Quills data.
  useEffect(() => {
    if (!userId) return;
    queryClient.removeQueries({
      predicate: (query) =>
        isOtherQuillsScope(query.queryKey, workspaceId, userId),
    });
  }, [queryClient, workspaceId, userId]);

  return (
    <WorkspaceLayout title={t("team.title")}>
      <StateView loading={viewer.kind !== "user"}>
        {viewer.kind === "user" ? (
          <TeamRuntimeProvider
            value={{
              workspaceId,
              viewer,
              permissions: {
                read: permission.canReadQuills(),
                create: permission.canCreateQuills(),
                update: permission.canUpdateQuills(),
                delete: permission.canDeleteQuills(),
                manageSettings: permission.canManageQuillsSettings(),
              },
            }}
          >
            <TeamShell workspaceId={workspaceId}>
              <Outlet />
            </TeamShell>
          </TeamRuntimeProvider>
        ) : null}
      </StateView>
    </WorkspaceLayout>
  );
}
