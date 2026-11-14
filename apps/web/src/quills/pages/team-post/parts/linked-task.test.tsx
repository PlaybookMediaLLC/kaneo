import { describe, expect, it } from "vite-plus/test";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { LinkedTask } from "./linked-task";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";

const router = createRouter({
  routeTree: createRootRoute(),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
const render = () =>
  renderComponent(
    <RouterContextProvider router={router}>
      <LinkedTask workspaceId="workspace_test_1" taskId="task_csv" />
    </RouterContextProvider>,
  );

describe("LinkedTask", () => {
  it("links the task title to the Kaneo task", async () => {
    mockApi().reply({
      id: "task_csv",
      projectId: "project_web",
      title: "Build the CSV export",
    });
    const view = render();
    expect(
      await view.findByRole("link", { name: "Build the CSV export" }),
    ).toHaveAttribute(
      "href",
      "/dashboard/workspace/workspace_test_1/project/project_web/task/task_csv",
    );
  });

  it("does not show a task that the viewer cannot open", async () => {
    mockApi().reply({ message: "Forbidden" }, 403);
    const view = render();
    expect(await view.findByText("A task that you cannot open")).toBeVisible();
  });
});
