import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { PropertyRow } from "./property-row";

describe("PropertyRow", () => {
  it("pairs the label with its value", () => {
    const view = renderComponent(
      <PropertyRow label="Priority">
        <span>High</span>
      </PropertyRow>,
    );
    expect(view.getByRole("term")).toHaveTextContent("Priority");
    expect(view.getByRole("definition")).toHaveTextContent("High");
  });
});
