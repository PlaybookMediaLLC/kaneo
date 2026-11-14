import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { ShortcutListener } from "../upstream";
import { FloatingActionBar } from "./floating-action-bar";

describe("FloatingActionBar", () => {
  it("runs an action by button and by its key, and ignores the key of a disabled action", () => {
    const reply = vi.fn();
    const note = vi.fn();
    const view = renderComponent(
      <>
        <ShortcutListener />
        <FloatingActionBar
          label="Conversation actions"
          status={<button type="button">Open</button>}
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
        </FloatingActionBar>
      </>,
    );
    const bar = view.getByRole("group", { name: "Conversation actions" });
    expect(bar).toContainElement(view.getByRole("button", { name: "More" }));
    expect(bar).toContainElement(view.getByRole("button", { name: "Open" }));
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

  it("shows the black main button and the arrows", () => {
    const accept = vi.fn();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const view = renderComponent(
      <FloatingActionBar
        label="Request actions"
        primary={{ id: "accept", label: "Accept", onSelect: accept }}
        onPrevious={onPrevious}
        onNext={onNext}
      />,
    );
    press("Accept");
    press("Previous");
    press("Next");
    expect(
      [accept, onPrevious, onNext].map((f) => f.mock.calls.length),
    ).toEqual([1, 1, 1]);
    expect(view.getByRole("button", { name: "Previous" })).toHaveAttribute(
      "aria-keyshortcuts",
      "K",
    );
  });
});
