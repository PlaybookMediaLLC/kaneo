import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { Composer, type ComposerProps } from "./composer";

const modes = [
  { value: "reply", label: "Reply" },
  { value: "note", label: "Note", private: true },
];

function renderComposer(props: Partial<ComposerProps> = {}) {
  const onSend = vi.fn();
  const onChange = vi.fn();
  const view = renderComponent(
    <Composer
      label="Reply to Ada…"
      value="Thanks"
      onChange={onChange}
      onSend={onSend}
      {...props}
    />,
  );
  return { view, onSend, onChange };
}

describe("Composer", () => {
  it("sends on Enter and on the button, and adds a line on Shift+Enter", () => {
    const { view, onSend, onChange } = renderComposer();
    const box = view.getByRole("textbox", { name: "Reply to Ada…" });
    fireEvent.change(box, { target: { value: "Thanks!" } });
    expect(onChange).toHaveBeenCalledWith("Thanks!");
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    press("Send");
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it("does not send empty text or while sending", () => {
    const { view, onSend } = renderComposer({ value: "  " });
    fireEvent.keyDown(view.getByRole("textbox"), { key: "Enter" });
    expect(view.getByRole("button", { name: "Send" })).toBeDisabled();
    view.rerender(
      <Composer
        label="Reply"
        value="Thanks"
        onChange={() => undefined}
        onSend={onSend}
        sending
      />,
    );
    fireEvent.keyDown(view.getByRole("textbox"), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("switches the mode and tints a private mode", async () => {
    const onModeChange = vi.fn();
    const { view } = renderComposer({ modes, mode: "note", onModeChange });
    expect(view.getByRole("textbox").parentElement).toHaveClass("bg-warning/5");
    press("Mode: Note");
    fireEvent.click(await view.findByRole("menuitemradio", { name: "Reply" }));
    expect(onModeChange).toHaveBeenCalledWith("reply");
  });

  it("shows the tools slot", () => {
    const { view } = renderComposer({
      tools: <button type="button">Attach</button>,
    });
    expect(view.getByRole("button", { name: "Attach" })).toBeVisible();
    expect(view.queryByRole("button", { name: /^Mode/ })).toBeNull();
  });
});
