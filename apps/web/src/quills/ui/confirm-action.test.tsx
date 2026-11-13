import { describe, expect, it, vi } from "vite-plus/test";
import { ConfirmAction } from "./confirm-action";
import { renderComponent } from "../test/render";
import { press } from "../test/actions";

describe("ConfirmAction", () => {
  it("runs only after the button is pressed", () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    const view = renderComponent(
      <ConfirmAction labelKey="core.gallery.confirm" onConfirm={confirm} />,
    );
    expect(confirm).not.toHaveBeenCalled();
    view.getByRole("button").click();
    expect(confirm).toHaveBeenCalledOnce();
  });
  it("contains a failed action and allows an explicit retry", async () => {
    const confirm = vi
      .fn()
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValue(undefined);
    const view = renderComponent(
      <ConfirmAction labelKey="core.gallery.confirm" onConfirm={confirm} />,
    );
    press(/confirm/i);
    await view.findByRole("alert");
    expect(view.getByRole("button")).not.toBeDisabled();
    press(/confirm/i);
    expect(confirm).toHaveBeenCalledTimes(2);
  });
  it("prevents duplicate submission while the first action is pending", () => {
    const confirm = vi.fn(() => new Promise<void>(() => {}));
    renderComponent(
      <ConfirmAction labelKey="core.gallery.confirm" onConfirm={confirm} />,
    );
    press(/confirm/i);
    press(/confirm/i);
    expect(confirm).toHaveBeenCalledOnce();
  });
  it("preserves switch and pressed-button semantics", () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    const view = renderComponent(
      <>
        <ConfirmAction
          labelKey="core.gallery.confirm"
          role="switch"
          aria-checked
          onConfirm={confirm}
        />
        <ConfirmAction
          labelKey="core.gallery.confirm"
          pressed={false}
          onConfirm={confirm}
        />
      </>,
    );
    expect(view.getByRole("switch")).toBeChecked();
    expect(view.getByRole("button")).toHaveAttribute("aria-pressed", "false");
  });
});
