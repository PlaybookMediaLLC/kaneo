import { describe, expect, it, vi } from "vite-plus/test";
import { choose } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { TicketSelect } from "./ticket-select";

const options = [
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
];

describe("TicketSelect", () => {
  it("shows the current value and reports a new one", async () => {
    const onChange = vi.fn();
    const view = renderComponent(
      <TicketSelect
        label="Priority"
        value="low"
        options={options}
        onChange={onChange}
      />,
    );
    expect(view.getByRole("combobox", { name: "Priority" })).toHaveTextContent(
      "Low",
    );
    await choose("Priority", "High");
    expect(onChange).toHaveBeenCalledWith("high");
  });

  it("can be read only", () => {
    const view = renderComponent(
      <TicketSelect
        label="Priority"
        value="low"
        options={options}
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(view.getByRole("combobox", { name: "Priority" })).toHaveAttribute(
      "data-disabled",
    );
  });
});
