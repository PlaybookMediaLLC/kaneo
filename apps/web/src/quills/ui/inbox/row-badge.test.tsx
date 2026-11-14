import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { RowBadge } from "./row-badge";

describe("RowBadge", () => {
  it("shows the label in the tone of the badge", () => {
    const view = renderComponent(
      <RowBadge
        badge={{ id: "resolved", label: "Resolved", tone: "success" }}
      />,
    );
    expect(view.getByText("Resolved")).toHaveClass("uppercase");
    expect(view.getByText("Resolved").className).toMatch(/success/);
  });
});
