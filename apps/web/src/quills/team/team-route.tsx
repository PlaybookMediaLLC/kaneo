import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { usePortalViewer } from "../core/use-portal-viewer";
import { StateView } from "../ui/state-view";
import {
  useActiveWorkspace,
  useWorkspaceArchived,
  useWorkspacePermission,
  WorkspaceArchived,
} from "../ui/upstream";
import { TeamRuntimeProvider } from "./runtime";
import { isOtherQuillsScope } from "./team-cache";
import { TeamShell } from "./team-shell";

/**
 * The layout of the teammate app at /feedback/{id} (RFC 0004 D1). It replaces Kaneo's
 * workspace layout. Kaneo's authenticated layout still provides the session, the user
 * WebSocket (QUILLS_CHANGED and access changes) and the global shortcuts. The workspace
 * permissions and the active workspace read the workspaceId route parameter.
 */
export function TeamRoute() {
  const workspaceId = useParams({
    strict: false,
    select: (params) =>
      "workspaceId" in params ? String(params.workspaceId) : "",
  });
  const viewer = usePortalViewer();
  const permission = useWorkspacePermission();
  const { data: workspace } = useActiveWorkspace();
  const archived = useWorkspaceArchived(workspaceId);
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

  if (archived) return <WorkspaceArchived />;
  return (
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
          <TeamShell
            workspaceId={workspaceId}
            // The active workspace falls back to another one when the route ID is unknown.
            workspaceName={
              workspace?.id === workspaceId ? workspace.name : undefined
            }
            workspaceLogo={
              workspace?.id === workspaceId ? workspace.logo : undefined
            }
            workspaceRole={permission.role}
          >
            <Outlet />
          </TeamShell>
        </TeamRuntimeProvider>
      ) : null}
    </StateView>
  );
}
