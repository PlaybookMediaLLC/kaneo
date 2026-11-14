import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { quillsKey } from "../api/keys";
import { renderComponent } from "../test/render";
import { useTeamRuntime } from "./runtime";
import { TeamRoute } from "./team-route";

vi.mock("@/components/common/workspace-layout", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user_1" } } }) },
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canReadQuills: () => true,
    canCreateQuills: () => true,
    canUpdateQuills: () => false,
    canDeleteQuills: () => false,
    canManageQuillsSettings: () => false,
  }),
}));

function TeamPage() {
  const team = useTeamRuntime();
  return (
    <output>
      {team.workspaceId}:{team.viewer.id}:{String(team.permissions.create)}:
      {String(team.permissions.update)}
    </output>
  );
}

function renderTeam(path: string) {
  const root = createRootRoute();
  const team = createRoute({
    getParentRoute: () => root,
    path: "/dashboard/workspace/$workspaceId/quills",
    component: TeamRoute,
  });
  const home = createRoute({
    getParentRoute: () => team,
    path: "/",
    component: TeamPage,
  });
  const router = createRouter({
    routeTree: root.addChildren([team.addChildren([home])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return Object.assign(renderComponent(<RouterProvider router={router} />), {
    router,
  });
}

describe("TeamRoute", () => {
  it("renders the app header title, the team navigation and the page", async () => {
    const view = renderTeam("/dashboard/workspace/workspace_1/quills");
    expect(
      await view.findByRole("region", { name: "Feedback" }),
    ).toBeInTheDocument();
    expect(
      view.getByRole("navigation", { name: /feedback/i }),
    ).toBeInTheDocument();
    expect(await view.findByRole("status")).toHaveTextContent(
      "workspace_1:user_1:true:false",
    );
  });

  it("drops the Quills data of the previous workspace on a switch", async () => {
    const view = renderTeam("/dashboard/workspace/workspace_1/quills");
    await view.findByRole("status");
    const user = { kind: "user", id: "user_1" } as const;
    const previous = quillsKey("workspace_1", user, "team", "listBoards");
    const next = quillsKey("workspace_2", user, "team", "listBoards");
    view.queryClient.setQueryData(previous, { items: [] });
    view.queryClient.setQueryData(next, { items: [] });
    await act(() =>
      view.router.navigate({ to: "/dashboard/workspace/workspace_2/quills" }),
    );
    expect(await view.findByRole("status")).toHaveTextContent("workspace_2");
    expect(view.queryClient.getQueryData(previous)).toBeUndefined();
    expect(view.queryClient.getQueryData(next)).toEqual({ items: [] });
  });
});
