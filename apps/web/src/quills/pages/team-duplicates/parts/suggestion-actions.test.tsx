import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { ShortcutListener } from "../../../ui/upstream";
import { suggestionsFixture } from "../suggestions.fixture";
import {
  SuggestionActions,
  type SuggestionActionsProps,
} from "./suggestion-actions";

const render = (overrides: Partial<SuggestionActionsProps> = {}) => {
  const calls = { onMerge: vi.fn(), onDismiss: vi.fn(), onRestore: vi.fn() };
  const view = renderComponent(
    <>
      <ShortcutListener />
      <SuggestionActions
        suggestion={suggestionsFixture.suggestion()}
        canDecide
        busy={false}
        {...calls}
        {...overrides}
      />
    </>,
  );
  return { view, calls };
};

describe("SuggestionActions", () => {
  it("offers merge and dismiss for a pending pair, by button and by key", () => {
    const { view, calls } = render();
    expect(view.getByRole("group", { name: "Pair actions" })).toHaveTextContent(
      /^Pending/,
    );
    // Merge is the main button at the end of the bar.
    expect(view.getAllByRole("button").at(-1)).toHaveAccessibleName(/^Merge/);
    press("Merge");
    fireEvent.keyDown(document.body, { key: "d", code: "KeyD" });
    expect(calls.onMerge).toHaveBeenCalledOnce();
    expect(calls.onDismiss).toHaveBeenCalledOnce();
    expect(view.queryByRole("button", { name: "Restore" })).toBeNull();
  });

  it("offers only a restore for a dismissed pair", () => {
    const { view, calls } = render({
      suggestion: suggestionsFixture.suggestion({ status: "dismissed" }),
    });
    expect(view.getAllByRole("button")).toHaveLength(1);
    press("Restore");
    expect(calls.onRestore).toHaveBeenCalledOnce();
  });

  it("shows no decision without permission and waits while one runs", () => {
    const { view } = render({ canDecide: false });
    expect(view.queryByRole("group")).toBeNull();
    view.unmount();
    const busy = render({ busy: true });
    expect(busy.view.getByRole("button", { name: "Merge" })).toBeDisabled();
  });
});
