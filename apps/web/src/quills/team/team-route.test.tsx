import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getTeamCountsFixture } from "../api/team/get-team-counts.fixture";
import { quillsKey } from "../api/keys";
import { mockApi } from "../test/mock-api";
import { renderComponent } from "../test/render";
import { useTeamRuntime } from "./runtime";
import { TeamRoute } from "./team-route";

const state = vi.hoisted(() => ({ archived: false }));
vi.mock("@/hooks/queries/workspace/use-workspace-archived", () => ({
  default: () => state.archived,
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace_1", name: "Acme" } }),
}));
vi.mock("@/components/common/workspace-archived", () => ({
  default: () => <h1>Workspace archived</h1>,
}));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));
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
    path: "/feedback/$workspaceId",
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
  beforeEach(() => {
    state.archived = false;
  });

  it("renders the app shell without the Kaneo sidebar, with the runtime for the page", async () => {
    mockApi().reply(getTeamCountsFixture.ok());
    const view = renderTeam("/feedback/workspace_1");
    expect(await view.findByRole("status")).toHaveTextContent(
      "workspace_1:user_1:true:false",
    );
    expect(
      view.getByRole("navigation", { name: "App sections" }),
    ).toBeInTheDocument();
    expect(view.getByRole("main")).toContainElement(view.getByRole("status"));
    expect(view.getByText("Acme")).toBeVisible();
  });

  it("drops the Quills data of the previous workspace on a switch", async () => {
    const api = mockApi();
    api.reply(getTeamCountsFixture.ok());
    api.reply(getTeamCountsFixture.ok());
    const view = renderTeam("/feedback/workspace_1");
    await view.findByRole("status");
    const user = { kind: "user", id: "user_1" } as const;
    const previous = quillsKey("workspace_1", user, "team", "listBoards");
    const next = quillsKey("workspace_2", user, "team", "listBoards");
    view.queryClient.setQueryData(previous, { items: [] });
    view.queryClient.setQueryData(next, { items: [] });
    await act(() => view.router.navigate({ to: "/feedback/workspace_2" }));
    expect(await view.findByRole("status")).toHaveTextContent("workspace_2");
    expect(view.queryClient.getQueryData(previous)).toBeUndefined();
    expect(view.queryClient.getQueryData(next)).toEqual({ items: [] });
    // The active workspace is another one, so its name is not shown.
    expect(view.queryByText("Acme")).toBeNull();
  });

  it("shows the archived state instead of the app for an archived workspace", async () => {
    state.archived = true;
    const view = renderTeam("/feedback/workspace_1");
    expect(
      await view.findByRole("heading", { name: "Workspace archived" }),
    ).toBeInTheDocument();
    expect(view.queryByRole("main")).toBeNull();
  });
});
