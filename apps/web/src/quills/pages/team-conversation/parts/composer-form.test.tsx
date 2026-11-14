import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { fill, press } from "../../../test/actions";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { ComposerForm } from "./composer-form";

describe("ComposerForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(
        <ComposerForm
          mode="reply"
          onSubmit={(content) => onSubmit({ content })}
          onCancel={() => undefined}
        />,
      ),
    fieldName: "Reply to the customer",
    issuePath: "content",
    submitName: "Send reply",
    validValue: "Fixed now",
    expectedValues: { content: "Fixed now" },
    invalidValue: "   ",
  });

  it("sends a reply once, reports typing and refuses an empty reply", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const onTyping = vi.fn();
    const view = renderComponent(
      <ComposerForm
        mode="reply"
        onSubmit={onSubmit}
        onTyping={onTyping}
        onCancel={() => undefined}
      />,
    );
    press("Send reply");
    expect(await view.findByLabelText("Reply to the customer")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(onSubmit).not.toHaveBeenCalled();
    fill("Reply to the customer", "  Fixed now.  ");
    expect(onTyping).toHaveBeenCalled();
    fireEvent.keyDown(view.getByLabelText("Reply to the customer"), {
      key: "Enter",
      ctrlKey: true,
    });
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Fixed now."));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("labels a note as internal and cancels", () => {
    const onCancel = vi.fn();
    const view = renderComponent(
      <ComposerForm mode="note" onSubmit={vi.fn()} onCancel={onCancel} />,
    );
    expect(view.getByLabelText("Note for the team")).toBeInTheDocument();
    press("Cancel");
    expect(onCancel).toHaveBeenCalled();
    expect(view.getByRole("button", { name: "Save note" })).toBeInTheDocument();
  });
});
