import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { ShortcutListener } from "../upstream";
import { type KeyHandlers, useKeyShortcuts } from "./use-key-shortcuts";

function Probe({
  handlers,
  enabled,
}: {
  handlers: KeyHandlers;
  enabled?: boolean;
}) {
  useKeyShortcuts(handlers, enabled);
  return <input aria-label="Reply" />;
}

const render = (handlers: KeyHandlers, enabled?: boolean) =>
  renderComponent(
    <>
      <ShortcutListener />
      <Probe handlers={handlers} enabled={enabled} />
    </>,
  );

describe("useKeyShortcuts", () => {
  it("runs the handler of a pressed key and ignores the same key in a text field", () => {
    const reply = vi.fn();
    const view = render({ r: reply });
    fireEvent.keyDown(document.body, { key: "r", code: "KeyR" });
    expect(reply).toHaveBeenCalledOnce();
    fireEvent.keyDown(view.getByRole("textbox", { name: "Reply" }), {
      key: "r",
      code: "KeyR",
    });
    expect(reply).toHaveBeenCalledOnce();
  });

  it("binds nothing when disabled, for a missing handler or after the component leaves", () => {
    const reply = vi.fn();
    const view = render({ r: reply, n: undefined }, false);
    fireEvent.keyDown(document.body, { key: "r", code: "KeyR" });
    view.rerender(
      <>
        <ShortcutListener />
        <Probe handlers={{ r: reply }} />
      </>,
    );
    fireEvent.keyDown(document.body, { key: "r", code: "KeyR" });
    expect(reply).toHaveBeenCalledOnce();
    view.rerender(<ShortcutListener />);
    fireEvent.keyDown(document.body, { key: "r", code: "KeyR" });
    expect(reply).toHaveBeenCalledOnce();
  });
});
