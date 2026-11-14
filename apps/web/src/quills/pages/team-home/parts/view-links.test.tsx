import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { ViewLinks } from "./view-links";

const render = (counts?: { pendingDuplicates: number }) =>
  renderComponent(
    <RouterContextProvider
      router={createRouter({
        routeTree: createRootRoute(),
        history: createMemoryHistory(),
      })}
    >
      <ViewLinks workspaceId="workspace_test_1" counts={counts} />
    </RouterContextProvider>,
  );

describe("ViewLinks", () => {
  it("links each view by section with its count, but not the overview", () => {
    const view = render({ pendingDuplicates: 2 });
    expect(view.getByRole("region", { name: "Feedback" })).toContainElement(
      view.getByRole("link", { name: "Duplicates 2" }),
    );
    expect(view.getByRole("link", { name: "Duplicates 2" })).toHaveAttribute(
      "href",
      "/feedback/workspace_test_1/duplicates",
    );
    expect(view.getByRole("region", { name: "Settings" })).toBeInTheDocument();
    expect(view.queryByRole("link", { name: "Overview" })).toBeNull();
  });

  it("shows no count before the counts load", () => {
    const view = render();
    expect(view.getByRole("link", { name: "Duplicates" })).toBeInTheDocument();
  });
});
