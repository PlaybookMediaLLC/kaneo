import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { SidebarProvider } from "../ui/upstream";
import { QuillsSidebarEntry } from "./sidebar-entry";

const state = vi.hoisted(() => ({ canRead: true }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace_1" } }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canReadQuills: () => state.canRead }),
}));

function renderEntry(path: string) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return renderComponent(
    <RouterContextProvider router={router}>
      <SidebarProvider>
        <QuillsSidebarEntry />
      </SidebarProvider>
    </RouterContextProvider>,
  );
}

describe("QuillsSidebarEntry", () => {
  beforeEach(() => {
    state.canRead = true;
  });

  it("links the workspace sidebar to the team shell and marks it active there", async () => {
    const view = renderEntry("/dashboard/workspace/workspace_1/quills/other");
    const link = await view.findByRole("link", { name: "Feedback" });
    expect(link).toHaveAttribute(
      "href",
      "/dashboard/workspace/workspace_1/quills",
    );
    expect(link).toHaveAttribute("data-active", "true");
  });

  it("is not active on another workspace page", async () => {
    const view = renderEntry("/dashboard/workspace/workspace_1/inbox");
    const link = await view.findByRole("link", { name: "Feedback" });
    expect(link).toHaveAttribute("data-active", "false");
  });

  it("hides the shortcut from a member without Quills read access", () => {
    state.canRead = false;
    const view = renderEntry("/dashboard/workspace/workspace_1");
    expect(view.queryByRole("link")).not.toBeInTheDocument();
  });
});
