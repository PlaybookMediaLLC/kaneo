import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { TicketComposerForm } from "./ticket-composer-form";

describe("TicketComposerForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(
        <TicketComposerForm
          mode="reply"
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />,
      ),
    fieldName: "Reply to the requester",
    issuePath: "content",
    submitName: "Send reply",
    validValue: "We fixed the login.",
    expectedValues: { content: "We fixed the login." },
    invalidValue: " ",
  });

  it("writes an internal note and can be closed", () => {
    const onCancel = vi.fn();
    const view = renderComponent(
      <TicketComposerForm mode="note" onSubmit={vi.fn()} onCancel={onCancel} />,
    );
    expect(view.getByLabelText("Internal note")).toHaveFocus();
    expect(view.getByRole("button", { name: "Save note" })).toBeInTheDocument();
    press("Cancel");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
