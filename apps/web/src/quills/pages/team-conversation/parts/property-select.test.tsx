import { describe, expect, it, vi } from "vite-plus/test";
import { choose } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { PropertySelect } from "./property-select";

const options = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
];

describe("PropertySelect", () => {
  it("shows the current value and reports another choice only", async () => {
    const onChange = vi.fn();
    const view = renderComponent(
      <PropertySelect
        label="Status"
        value="open"
        options={options}
        onChange={onChange}
      />,
    );
    expect(view.getByRole("combobox", { name: "Status" })).toHaveTextContent(
      "Open",
    );
    await choose("Status", "Closed");
    expect(onChange).toHaveBeenCalledWith("closed");
  });
});
