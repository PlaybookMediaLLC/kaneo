import { describe, expect, it, vi } from "vite-plus/test";
import { fill, press } from "../../../test/actions";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { NewTicketForm } from "./new-ticket-form";

describe("NewTicketForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(<NewTicketForm onSubmit={onSubmit} onCancel={vi.fn()} />),
    fieldName: "Title",
    issuePath: "title",
    submitName: "Create ticket",
    validValue: "Login fails",
    expectedValues: { title: "Login fails", description: "" },
    invalidValue: " ",
  });

  it("sends the title and the details, and cancels", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const onCancel = vi.fn();
    renderComponent(<NewTicketForm onSubmit={onSubmit} onCancel={onCancel} />);
    fill("Title", " Login fails ");
    fill("Details (optional)", "Since Monday.");
    press("Create ticket");
    await vi.waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        title: "Login fails",
        description: "Since Monday.",
      }),
    );
    press("Cancel");
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
