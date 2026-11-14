import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { fireEvent } from "@testing-library/react";
import { Lightbulb } from "lucide-react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../test/render";
import type { TeamNavSection } from "./nav";
import { SectionNav } from "./section-nav";

const section: TeamNavSection = {
  id: "feedback",
  labelKey: "team.sections.feedback",
  icon: Lightbulb,
  items: [
    { path: "", labelKey: "team.nav.home" },
    {
      path: "/duplicates",
      labelKey: "duplicates.nav",
      countKey: "pendingDuplicates",
    },
    {
      path: "/autopilot",
      labelKey: "autopilot.nav",
      countKey: "pendingSignals",
    },
  ],
  browse: [{ path: "/surveys", labelKey: "surveys.title" }],
};

function renderNav(path: string, browse = section.browse) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const onNavigate = vi.fn();
  const view = renderComponent(
    <RouterContextProvider router={router}>
      <SectionNav
        workspaceId="workspace_1"
        workspaceName="Acme"
        section={{ ...section, browse }}
        counts={{ pendingDuplicates: 3, pendingSignals: 0 }}
        onNavigate={onNavigate}
      />
    </RouterContextProvider>,
  );
  return { view, onNavigate };
}

describe("SectionNav", () => {
  it("lists the views with their counts and marks the current one", async () => {
    const { view } = renderNav("/feedback/workspace_1/duplicates");
    const nav = view.getByRole("navigation", { name: "Feedback views" });
    const duplicates = await view.findByRole("link", { name: "Duplicates 3" });
    expect(nav).toContainElement(duplicates);
    expect(duplicates).toHaveAttribute(
      "href",
      "/feedback/workspace_1/duplicates",
    );
    expect(duplicates).toHaveAttribute("aria-current", "page");
    expect(view.getByRole("link", { name: "Overview" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(view.getByRole("link", { name: /Autopilot 0/ })).toBeVisible();
    expect(view.getByText("Acme")).toBeVisible();
  });

  it("shows the Browse group open, folds it, and reports a chosen view", async () => {
    const { view, onNavigate } = renderNav("/feedback/workspace_1");
    const group = view.getByText("Browse").closest("details")!;
    expect(group).toHaveAttribute("open");
    fireEvent.click(view.getByText("Browse"));
    expect(group).not.toHaveAttribute("open");
    fireEvent.click(await view.findByRole("link", { name: "Overview" }));
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("hides an empty Browse group", () => {
    const { view } = renderNav("/feedback/workspace_1", []);
    expect(view.queryByText("Browse")).toBeNull();
  });
});
