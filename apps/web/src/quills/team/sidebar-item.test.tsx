import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { fireEvent, waitFor } from "@testing-library/react";
import { Zap } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../test/render";
import type { TeamNavItem } from "./nav";
import { SidebarItem } from "./sidebar-item";

const render = (item: TeamNavItem, onNavigate = () => undefined) =>
  renderComponent(
    <RouterContextProvider
      router={createRouter({
        routeTree: createRootRoute(),
        history: createMemoryHistory({
          initialEntries: ["/feedback/workspace_1/conversations/queue"],
        }),
      })}
    >
      <SidebarItem item={item} onNavigate={onNavigate} />
    </RouterContextProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("SidebarItem", () => {
  it("links a view with its count and marks the current one", () => {
    const onNavigate = vi.fn();
    const view = render(
      {
        id: "queue",
        labelKey: "team-conversations.views.queue",
        icon: Zap,
        to: "/feedback/workspace_1/conversations/queue",
        count: 0,
        attention: true,
      },
      onNavigate,
    );
    const link = view.getByRole("link", { name: "Queue 0" });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(view.getByText("0")).not.toHaveClass("bg-priority-high");
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("opens the portal in a new tab", () => {
    const view = render({
      id: "roadmap",
      labelKey: "team.nav.roadmap",
      to: "/portal/workspace_1/roadmap",
      newTab: true,
    });
    expect(view.getByRole("link", { name: "Roadmap" })).toHaveAttribute(
      "target",
      "_blank",
    );
  });

  it("copies a full link for Share", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const view = render({
      id: "share",
      labelKey: "team.nav.share",
      to: "/portal/workspace_1",
      copy: true,
    });
    fireEvent.click(view.getByRole("button", { name: "Share" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/portal/workspace_1`,
      ),
    );
  });
});
