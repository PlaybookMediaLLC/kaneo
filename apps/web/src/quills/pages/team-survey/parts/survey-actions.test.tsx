import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { ShortcutListener } from "../../../ui/upstream";
import { SurveyActions, type SurveyActionsProps } from "./survey-actions";

const render = (overrides: Partial<SurveyActionsProps> = {}) => {
  const calls = { onActivate: vi.fn(), onClose: vi.fn(), onDelete: vi.fn() };
  const view = renderComponent(
    <>
      <ShortcutListener />
      <SurveyActions
        status="draft"
        canUpdate
        canDelete
        busy={false}
        {...calls}
        {...overrides}
      />
    </>,
  );
  return { view, calls };
};

describe("SurveyActions", () => {
  it("activates or deletes a draft, and deletes only by button", () => {
    const { view, calls } = render();
    expect(
      view.getByRole("group", { name: "Survey actions" }),
    ).toHaveTextContent(/^Draft/);
    // The next status is the main button at the end of the bar.
    expect(view.getAllByRole("button").at(-1)).toHaveAccessibleName(
      /^Activate survey/,
    );
    fireEvent.keyDown(document.body, { key: "a", code: "KeyA" });
    press("Delete draft");
    expect(calls.onActivate).toHaveBeenCalledOnce();
    expect(calls.onDelete).toHaveBeenCalledOnce();
    expect(
      view.getByRole("button", { name: "Delete draft" }),
    ).not.toHaveAttribute("aria-keyshortcuts");
    expect(view.queryByRole("button", { name: "Close survey" })).toBeNull();
  });

  it("closes an active survey and offers nothing for a closed one", () => {
    const { view, calls } = render({ status: "active" });
    press("Close survey");
    expect(calls.onClose).toHaveBeenCalledOnce();
    expect(view.getAllByRole("button")).toHaveLength(1);
    view.unmount();
    expect(render({ status: "closed" }).view.queryByRole("group")).toBeNull();
  });

  it("hides the actions without the permissions and waits while one runs", () => {
    expect(
      render({ canUpdate: false, canDelete: false }).view.queryByRole("group"),
    ).toBeNull();
    const { view } = render({ busy: true, status: "active" });
    expect(view.getByRole("button", { name: "Close survey" })).toBeDisabled();
  });
});
