import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { TeamShell } from "./team-shell";

function renderShell(path: string) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return renderComponent(
    <RouterContextProvider router={router}>
      <TeamShell workspaceId="workspace_1">
        <p>Page content</p>
      </TeamShell>
    </RouterContextProvider>,
  );
}

describe("TeamShell", () => {
  it("links every entry inside the workspace and marks the current page", async () => {
    const view = renderShell("/dashboard/workspace/workspace_1/quills");
    const navigation = view.getByRole("navigation", { name: /feedback/i });
    const overview = await view.findByRole("link", { name: "Overview" });
    expect(navigation).toContainElement(overview);
    expect(overview).toHaveAttribute(
      "href",
      "/dashboard/workspace/workspace_1/quills",
    );
    expect(overview).toHaveAttribute("aria-current", "page");
    expect(view.getByText("Page content")).toBeInTheDocument();
  });

  it("does not mark the overview on another teammate page", async () => {
    const view = renderShell("/dashboard/workspace/workspace_1/quills/other");
    const overview = await view.findByRole("link", { name: "Overview" });
    expect(overview).not.toHaveAttribute("aria-current");
  });
});
