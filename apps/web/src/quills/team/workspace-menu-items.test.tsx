import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { Menu, MenuPopup } from "../ui/upstream";
import { WorkspaceMenuItems } from "./workspace-menu-items";

vi.mock("@/hooks/queries/workspace/use-get-workspaces", () => ({
  default: () => ({ data: [{ id: "workspace 2", name: "Globex" }] }),
}));

describe("WorkspaceMenuItems", () => {
  it("links each workspace to its teammate app", async () => {
    const view = renderComponent(
      <RouterContextProvider
        router={createRouter({
          routeTree: createRootRoute(),
          history: createMemoryHistory(),
        })}
      >
        <Menu open>
          <MenuPopup>
            <WorkspaceMenuItems />
          </MenuPopup>
        </Menu>
      </RouterContextProvider>,
    );
    expect(
      await view.findByRole("menuitem", { name: "Globex" }),
    ).toHaveAttribute("href", "/feedback/workspace%202");
  });
});
