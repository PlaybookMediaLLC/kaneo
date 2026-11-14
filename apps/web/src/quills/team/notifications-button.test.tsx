import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { getNotificationUnreadCountFixture } from "../api/team/get-notification-unread-count.fixture";
import { listNotificationsFixture } from "../api/team/list-notifications.fixture";
import { markAllNotificationsReadFixture } from "../api/team/mark-all-notifications-read.fixture";
import { markNotificationReadFixture } from "../api/team/mark-notification-read.fixture";
import { press } from "../test/actions";
import { mockApi } from "../test/mock-api";
import { renderComponent } from "../test/render";
import { NotificationsButton } from "./notifications-button";
import { TeamRuntimeProvider } from "./runtime";

const team = {
  workspaceId: "workspace_1",
  viewer: { kind: "user" as const, id: "user_1" },
  permissions: {
    read: true,
    create: true,
    update: true,
    delete: true,
    manageSettings: true,
  },
};
const notification = {
  id: "notification_1",
  type: "comment",
  title: "New comment on Dark mode",
  body: "**Yes**, please",
  postId: "post_1",
  commentId: null,
  readAt: null,
  createdAt: "2026-10-31T12:00:00.000Z",
  post: { id: "post_1", title: "Dark mode" },
};

const render = () =>
  renderComponent(
    <RouterContextProvider
      router={createRouter({
        routeTree: createRootRoute(),
        history: createMemoryHistory(),
      })}
    >
      <TeamRuntimeProvider value={team}>
        <NotificationsButton workspaceId="workspace_1" />
      </TeamRuntimeProvider>
    </RouterContextProvider>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("NotificationsButton", () => {
  it("shows the unread count and lists the notifications when opened", async () => {
    const api = mockApi();
    api.reply(getNotificationUnreadCountFixture.ok({ count: 2 }));
    api.reply(
      listNotificationsFixture.ok({
        notifications: [notification],
        total: 1,
        unreadCount: 2,
      }),
    );
    api.reply(markNotificationReadFixture.ok());
    const view = render();
    fireEvent.click(
      await view.findByRole("button", { name: "Notifications, 2 unread" }),
    );
    const item = await view.findByRole("link", {
      name: /New comment on Dark mode/,
    });
    expect(item).toHaveAttribute("href", "/feedback/workspace_1/posts/post_1");
    expect(item).toHaveTextContent("Yes, please");
    expect(item).toHaveTextContent("Unread");
    fireEvent.click(item);
    await waitFor(() =>
      expect(api.calls("markQuillsNotificationRead")).toHaveLength(1),
    );
  });

  it("marks all as read", async () => {
    const api = mockApi();
    api.reply(getNotificationUnreadCountFixture.ok({ count: 1 }));
    api.reply(listNotificationsFixture.ok({ notifications: [notification] }));
    api.reply(markAllNotificationsReadFixture.ok());
    api.reply(getNotificationUnreadCountFixture.ok());
    api.reply(listNotificationsFixture.ok());
    const view = render();
    fireEvent.click(
      await view.findByRole("button", { name: "Notifications, 1 unread" }),
    );
    await view.findByRole("link", { name: /Dark mode/ });
    press("Mark all as read");
    await waitFor(() =>
      expect(api.calls("markQuillsAllNotificationsRead")).toHaveLength(1),
    );
  });

  it("shows a desktop notification for a new one while the app is in the background", async () => {
    const shown = vi.fn();
    vi.stubGlobal(
      "Notification",
      Object.assign(shown, { permission: "granted" }),
    );
    window.localStorage.setItem("quills.desktop-notifications", "on");
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const api = mockApi();
    api.reply(getNotificationUnreadCountFixture.ok({ count: 1 }));
    api.reply(getNotificationUnreadCountFixture.ok({ count: 3 }));
    const view = render();
    await view.findByRole("button", { name: /1 unread/ });
    void view.queryClient.invalidateQueries();
    await view.findByRole("button", { name: /3 unread/ });
    expect(shown).toHaveBeenCalledWith("2 new notifications");
    window.localStorage.clear();
  });
});
