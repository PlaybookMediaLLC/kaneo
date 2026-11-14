import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { TeamRuntimeProvider, useTeamRuntime } from "./runtime";

function Consumer() {
  const team = useTeamRuntime();
  return (
    <span>
      {team.workspaceId}:{team.viewer.id}:{String(team.permissions.update)}
    </span>
  );
}

describe("TeamRuntimeProvider", () => {
  it("shares the workspace, the signed-in user and the permissions", () => {
    const view = renderComponent(
      <TeamRuntimeProvider
        value={{
          workspaceId: "workspace_1",
          viewer: { kind: "user", id: "user_1" },
          permissions: {
            read: true,
            create: false,
            update: false,
            delete: false,
            manageSettings: false,
          },
        }}
      >
        <Consumer />
      </TeamRuntimeProvider>,
    );
    expect(view.getByText("workspace_1:user_1:false")).toBeInTheDocument();
  });
});
