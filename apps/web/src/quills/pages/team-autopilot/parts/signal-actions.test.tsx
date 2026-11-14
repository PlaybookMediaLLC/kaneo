import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { ShortcutListener } from "../../../ui/upstream";
import { signalsFixture } from "../signals.fixture";
import { SignalActions, type SignalActionsProps } from "./signal-actions";

const handlers = () => ({
  onAcceptAsPost: vi.fn(),
  onVote: vi.fn(),
  onDismiss: vi.fn(),
  onRestore: vi.fn(),
});
const render = (overrides: Partial<SignalActionsProps> = {}) => {
  const calls = handlers();
  const view = renderComponent(
    <>
      <ShortcutListener />
      <SignalActions
        signal={signalsFixture.signal()}
        canAccept
        canReview
        busy={false}
        {...calls}
        {...overrides}
      />
    </>,
  );
  return { view, calls };
};

describe("SignalActions", () => {
  it("offers accept, vote and dismiss for a pending signal, by button and by key", () => {
    const { view, calls } = render();
    expect(
      view.getByRole("group", { name: "Signal actions" }),
    ).toBeInTheDocument();
    press("Accept as new post");
    press("Add vote");
    press("Dismiss");
    expect(view.queryByRole("button", { name: "Restore" })).toBeNull();
    fireEvent.keyDown(document.body, { key: "d", code: "KeyD" });
    expect(calls.onAcceptAsPost).toHaveBeenCalledTimes(1);
    expect(calls.onVote).toHaveBeenCalledTimes(1);
    expect(calls.onDismiss).toHaveBeenCalledTimes(2);
  });

  it("offers no vote without a matching post", () => {
    const { view } = render({
      signal: signalsFixture.signal({ matchedPost: null }),
    });
    expect(view.queryByRole("button", { name: "Add vote" })).toBeNull();
  });

  it("offers only a restore for a dismissed signal, and nothing for an accepted one", () => {
    const { view, calls } = render({
      signal: signalsFixture.signal({ status: "dismissed" }),
    });
    expect(view.getAllByRole("button")).toHaveLength(1);
    press("Restore");
    expect(calls.onRestore).toHaveBeenCalledTimes(1);
    view.unmount();
    const accepted = render({
      signal: signalsFixture.signal({ status: "accepted" }),
    });
    expect(accepted.view.queryByRole("group")).toBeNull();
  });

  it("hides the decisions that the teammate lacks and waits while one runs", () => {
    const { view, calls } = render({ canAccept: false, busy: true });
    expect(view.getAllByRole("button")).toHaveLength(1);
    expect(view.getByRole("button", { name: "Dismiss" })).toBeDisabled();
    fireEvent.keyDown(document.body, { key: "d", code: "KeyD" });
    expect(calls.onDismiss).not.toHaveBeenCalled();
  });
});
