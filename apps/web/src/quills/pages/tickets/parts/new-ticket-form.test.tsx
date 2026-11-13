import { describe, expect, it, vi } from "vite-plus/test";
import { fill, press } from "../../../test/actions";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { NewTicketForm } from "./new-ticket-form";

describe("NewTicketForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(<NewTicketForm onSubmit={onSubmit} />),
    fieldName: "Title",
    issuePath: "title",
    submitName: "Create ticket",
    validValue: "Cannot sign in",
    expectedValues: { title: "Cannot sign in", description: "" },
    invalidValue: "",
  });
  it("labels and submits the customer-visible fields", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = renderComponent(<NewTicketForm onSubmit={onSubmit} />);
    expect(view.getByRole("textbox", { name: "Title" })).toBeInTheDocument();
    fill("Title", "Cannot sign in");
    fill("Description", "The link expired");
    press("Create ticket");
    await vi.waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        title: "Cannot sign in",
        description: "The link expired",
      }),
    );
  });
});
