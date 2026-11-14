import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import {
  ConversationMenu,
  type ConversationMenuProps,
} from "./conversation-menu";

function renderMenu(props: Partial<ConversationMenuProps>) {
  const handlers = {
    onSnooze: vi.fn(),
    onSpam: vi.fn(),
    onNotSpam: vi.fn(),
    onBlock: vi.fn(),
    onUnblock: vi.fn(),
  };
  const view = renderComponent(
    <ConversationMenu
      status="open"
      spam={false}
      blocked={false}
      {...handlers}
      {...props}
    />,
  );
  press("More actions");
  return { view, handlers };
}

describe("ConversationMenu", () => {
  it("snoozes, marks spam and blocks the sender of an open conversation", async () => {
    const { view, handlers } = renderMenu({});
    fireEvent.click(await view.findByRole("menuitem", { name: "Snooze" }));
    expect(handlers.onSnooze).toHaveBeenCalledTimes(1);
    press("More actions");
    fireEvent.click(
      await view.findByRole("menuitem", { name: "Mark as spam" }),
    );
    expect(handlers.onSpam).toHaveBeenCalledTimes(1);
    press("More actions");
    fireEvent.click(
      await view.findByRole("menuitem", { name: "Block sender" }),
    );
    expect(handlers.onBlock).toHaveBeenCalledTimes(1);
  });

  it("restores spam and unblocks a blocked sender", async () => {
    const { view, handlers } = renderMenu({
      status: "closed",
      spam: true,
      blocked: true,
    });
    expect(
      await view.findByRole("menuitem", { name: "Not spam" }),
    ).toBeVisible();
    expect(view.queryByRole("menuitem", { name: "Snooze" })).toBeNull();
    fireEvent.click(view.getByRole("menuitem", { name: "Unblock sender" }));
    expect(handlers.onUnblock).toHaveBeenCalledTimes(1);
  });

  it("offers no blocking for a visitor without a profile", async () => {
    const { view } = renderMenu({ blocked: null });
    await view.findByRole("menuitem", { name: "Mark as spam" });
    expect(view.queryByRole("menuitem", { name: /Block/ })).toBeNull();
  });
});
