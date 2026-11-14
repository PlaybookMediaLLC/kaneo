import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { getNotificationUnreadCountFixture } from "../api/team/get-notification-unread-count.fixture";
import { getTeamCountsFixture } from "../api/team/get-team-counts.fixture";
import { press } from "../test/actions";
import { mockApi } from "../test/mock-api";
import { renderComponent } from "../test/render";
import { TeamRuntimeProvider } from "./runtime";
import { TeamShell } from "./team-shell";

vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));

const counts = getTeamCountsFixture.ok({
  queueConversations: 3,
  openConversations: 5,
  pendingDuplicates: 2,
  postStatuses: [
    { id: "status_1", name: "Pending", color: "gray", count: 4 },
    { id: "status_2", name: "Planned", color: "blue", count: 1 },
  ],
});

function renderShell(path: string) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return renderComponent(
    <RouterContextProvider router={router}>
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
        <TeamShell
          workspaceId="workspace_1"
          workspaceName="Acme"
          workspaceRole="admin"
        >
          <p>Page content</p>
        </TeamShell>
      </TeamRuntimeProvider>
    </RouterContextProvider>,
  );
}

/** The sidebar asks for the unread notifications first, then the shell for the counts. */
function answer(body: unknown = counts, status = 200) {
  const api = mockApi();
  api.reply(getNotificationUnreadCountFixture.ok());
  api.reply(body, status);
  return api;
}

describe("TeamShell", () => {
  it("shows one sidebar with the sections, counts and the current view, and the page", async () => {
    const api = answer();
    const view = renderShell("/feedback/workspace_1/conversations/queue");
    const nav = view.getByRole("navigation", { name: "Teammate app" });
    for (const name of ["Conversations", "Requests", "Workspace"])
      expect(within(nav).getByRole("list", { name })).toBeInTheDocument();
    const queue = await within(nav).findByRole("link", { name: "Queue 3" });
    expect(queue).toHaveAttribute("aria-current", "page");
    expect(within(queue).getByText("3")).toHaveClass("bg-priority-high");
    expect(within(nav).getByText("5")).not.toHaveClass("bg-priority-high");
    expect(view.getByRole("button", { name: /^Acme/ })).toHaveTextContent(
      "Admin",
    );
    expect(view.getByRole("main")).toHaveTextContent("Page content");
    expect(api.calls("getQuillsTeamCounts")).toHaveLength(1);
  });

  it("lists the open post statuses as Requests, the first with the orange badge", async () => {
    answer();
    const view = renderShell("/feedback/workspace_1/posts?statusId=status_2");
    const requests = view.getByRole("list", { name: "Requests" });
    const pending = await within(requests).findByRole("link", {
      name: "Pending 4",
    });
    expect(within(pending).getByText("4")).toHaveClass("bg-priority-high");
    const planned = within(requests).getByRole("link", { name: "Planned 1" });
    expect(planned).toHaveAttribute(
      "href",
      "/feedback/workspace_1/posts?statusId=status_2",
    );
    expect(planned).toHaveAttribute("aria-current", "page");
    expect(pending).not.toHaveAttribute("aria-current");
  });

  it("shows the views without counts when the counts request fails", async () => {
    const api = answer(getTeamCountsFixture.problem(403).body, 403);
    const view = renderShell("/feedback/workspace_1");
    await waitFor(() => expect(api.calls()).toHaveLength(2));
    expect(view.getByRole("link", { name: "Queue" })).toBeVisible();
    expect(view.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens the sidebar in a sheet on small screens", async () => {
    const api = answer();
    api.reply(getNotificationUnreadCountFixture.ok());
    const view = renderShell("/feedback/workspace_1/insights");
    press("Menu");
    const sheet = await view.findByRole("dialog", { name: "Teammate app" });
    expect(
      await within(sheet).findByRole("link", { name: "Insights" }),
    ).toBeVisible();
  });
});
