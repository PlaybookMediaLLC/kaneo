import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { getNotificationUnreadCountFixture } from "../api/team/get-notification-unread-count.fixture";
import { getTeamCountsFixture } from "../api/team/get-team-counts.fixture";
import { mockApi } from "../test/mock-api";
import { renderComponent } from "../test/render";
import { TeamRuntimeProvider } from "./runtime";
import { TeamSidebar } from "./team-sidebar";

vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));

describe("TeamSidebar", () => {
  it("has the top buttons, the sections, the desktop card and Support", () => {
    mockApi().reply(getNotificationUnreadCountFixture.ok());
    vi.stubGlobal("Notification", { permission: "default" });
    const onNavigate = vi.fn();
    const view = renderComponent(
      <RouterContextProvider
        router={createRouter({
          routeTree: createRootRoute(),
          history: createMemoryHistory(),
        })}
      >
        <TeamRuntimeProvider
          value={{
            workspaceId: "workspace_1",
            viewer: { kind: "user", id: "user_1" },
            permissions: {
              read: true,
              create: true,
              update: true,
              delete: true,
              manageSettings: true,
            },
          }}
        >
          <TeamSidebar
            workspaceId="workspace_1"
            workspaceName="Acme"
            counts={getTeamCountsFixture.ok()}
            onNavigate={onNavigate}
          />
        </TeamRuntimeProvider>
      </RouterContextProvider>,
    );
    const create = view.getByRole("link", { name: "New request" });
    expect(create).toHaveAttribute(
      "href",
      "/feedback/workspace_1/posts?new=true",
    );
    fireEvent.click(create);
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(view.getByRole("button", { name: "Notifications" })).toBeVisible();
    const nav = view.getByRole("navigation", { name: "Teammate app" });
    expect(
      within(nav).getByRole("link", { name: "Under review 0" }),
    ).toBeVisible();
    expect(
      view.getByRole("switch", { name: "Desktop notifications" }),
    ).toBeVisible();
    expect(view.getByRole("link", { name: "Support" })).toHaveAttribute(
      "target",
      "_blank",
    );
    vi.unstubAllGlobals();
  });
});
