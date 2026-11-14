import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { ShortcutListener } from "../upstream";
import { ActionBar } from "./action-bar";

describe("ActionBar", () => {
  it("runs an action by button and by its key, and ignores the key of a disabled action", () => {
    const reply = vi.fn();
    const note = vi.fn();
    const view = renderComponent(
      <>
        <ShortcutListener />
        <ActionBar
          label="Conversation actions"
          actions={[
            { id: "reply", label: "Reply", shortcut: "r", onSelect: reply },
            {
              id: "note",
              label: "Add note",
              shortcut: "n",
              onSelect: note,
              disabled: true,
            },
          ]}
        >
          <button type="button">More</button>
        </ActionBar>
      </>,
    );
    const bar = view.getByRole("group", { name: "Conversation actions" });
    expect(bar).toContainElement(view.getByRole("button", { name: "More" }));
    expect(view.getByRole("button", { name: "Reply" })).toHaveAttribute(
      "aria-keyshortcuts",
      "R",
    );
    press("Reply");
    fireEvent.keyDown(document.body, { key: "r", code: "KeyR" });
    expect(reply).toHaveBeenCalledTimes(2);
    expect(view.getByRole("button", { name: "Add note" })).toBeDisabled();
    fireEvent.keyDown(document.body, { key: "n", code: "KeyN" });
    expect(note).not.toHaveBeenCalled();
  });
});
