import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { Headset, Lightbulb } from "lucide-react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { IconRail } from "./icon-rail";

vi.mock("@/components/user-avatar", () => ({
  UserAvatar: () => <button type="button">Account</button>,
}));

const sections = [
  {
    id: "feedback",
    labelKey: "team.sections.feedback",
    icon: Lightbulb,
    items: [{ path: "", labelKey: "team.nav.home" }],
    browse: [],
  },
  {
    id: "support",
    labelKey: "team.sections.support",
    icon: Headset,
    items: [{ path: "/conversations", labelKey: "team.nav.home" }],
    browse: [],
  },
];

function renderRail(path: string) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return renderComponent(
    <RouterContextProvider router={router}>
      <IconRail
        workspaceId="workspace_1"
        sections={sections}
        activeId="support"
        menu={<button type="button">Views</button>}
      />
    </RouterContextProvider>,
  );
}

describe("IconRail", () => {
  it("links each section to its first view and marks the active section", async () => {
    const view = renderRail("/feedback/workspace_1/conversations");
    const rail = view.getByRole("navigation", { name: "App sections" });
    const support = await view.findByRole("link", { name: "Support" });
    expect(rail).toContainElement(support);
    expect(support).toHaveAttribute(
      "href",
      "/feedback/workspace_1/conversations",
    );
    expect(support).toHaveAttribute("data-active", "true");
    const feedback = view.getByRole("link", { name: "Feedback" });
    expect(feedback).toHaveAttribute("href", "/feedback/workspace_1");
    expect(feedback).toHaveAttribute("data-active", "false");
    // The overview link is not current on another view of the app.
    expect(feedback).not.toHaveAttribute("aria-current");
  });

  it("leads back to the workspace and shows the account and the small-screen menu", async () => {
    const view = renderRail("/feedback/workspace_1");
    expect(
      await view.findByRole("link", { name: "Back to the workspace" }),
    ).toHaveAttribute("href", "/dashboard/workspace/workspace_1");
    expect(view.getByRole("button", { name: "Account" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Views" })).toBeInTheDocument();
  });
});
