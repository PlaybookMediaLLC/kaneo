import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../test/actions";
import { renderComponent } from "../test/render";
import { WorkspaceSwitcher } from "./workspace-switcher";

vi.mock("@/hooks/queries/workspace/use-get-workspaces", () => ({
  default: () => ({
    data: [
      { id: "workspace_1", name: "Acme" },
      { id: "workspace_2", name: "Globex" },
    ],
  }),
}));

const render = (workspaceRole?: string) =>
  renderComponent(
    <RouterContextProvider
      router={createRouter({
        routeTree: createRootRoute(),
        history: createMemoryHistory(),
      })}
    >
      <WorkspaceSwitcher
        workspaceId="workspace_1"
        workspaceName="Acme Corp"
        workspaceRole={workspaceRole}
      />
    </RouterContextProvider>,
  );

describe("WorkspaceSwitcher", () => {
  it("shows the workspace with its initials and the role badge", () => {
    const view = render("owner");
    const trigger = view.getByRole("button", { name: /Acme Corp/ });
    expect(trigger).toHaveTextContent("AC");
    expect(trigger).toHaveTextContent("Owner");
  });

  it("switches to another workspace or goes back to Kaneo", async () => {
    const view = render("Support lead");
    expect(view.getByText("Support lead")).toBeVisible();
    press(/Acme Corp/);
    expect(
      await view.findByRole("menuitem", { name: "Globex" }),
    ).toHaveAttribute("href", "/feedback/workspace_2");
    expect(view.getByRole("menuitem", { name: /^Back to / })).toHaveAttribute(
      "href",
      "/dashboard/workspace/workspace_1",
    );
  });
});
