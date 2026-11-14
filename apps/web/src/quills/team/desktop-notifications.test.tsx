import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { readDesktopChoice } from "./desktop-choice";
import { DesktopNotifications } from "./desktop-notifications";

const browser = (permission: NotificationPermission, answer = permission) => {
  const requestPermission = vi.fn(() => Promise.resolve(answer));
  vi.stubGlobal("Notification", { permission, requestPermission });
  return requestPermission;
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("DesktopNotifications", () => {
  it("asks the browser for permission and keeps the choice on this device", async () => {
    const ask = browser("default", "granted");
    const view = renderComponent(<DesktopNotifications />);
    const toggle = view.getByRole("switch", { name: "Desktop notifications" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(ask).toHaveBeenCalledOnce();
    expect(readDesktopChoice()).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(readDesktopChoice()).toBe(false);
  });

  it("says when the browser blocks notifications", async () => {
    browser("default", "denied");
    const view = renderComponent(<DesktopNotifications />);
    fireEvent.click(view.getByRole("switch"));
    expect(await view.findByRole("status")).toHaveTextContent(/blocks/);
    expect(view.getByRole("switch")).not.toBeChecked();
  });

  it("is left out when the browser has no notifications", () => {
    const view = renderComponent(<DesktopNotifications />);
    expect(view.queryByRole("switch")).toBeNull();
  });
});
