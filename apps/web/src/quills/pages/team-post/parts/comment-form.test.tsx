import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { CommentForm } from "./comment-form";

describe("CommentForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(
        <CommentForm
          mode="reply"
          onSubmit={onSubmit}
          onCancel={() => undefined}
        />,
      ),
    fieldName: "Reply on the portal",
    issuePath: "content",
    submitName: "Send reply",
    validValue: "We ship it in June.",
    invalidValue: "   ",
    expectedValues: { content: "We ship it in June." },
  });

  it("labels a note for the team and cancels with Escape", () => {
    const onCancel = vi.fn();
    const view = renderComponent(
      <CommentForm
        mode="note"
        onSubmit={async () => undefined}
        onCancel={onCancel}
      />,
    );
    const field = view.getByLabelText("Private note for the team");
    expect(field).toHaveFocus();
    expect(view.getByRole("button", { name: "Save note" })).toBeVisible();
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
