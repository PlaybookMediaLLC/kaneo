import { describe, expect, it, vi } from "vite-plus/test";
import { fill } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { RatingScale } from "./rating-scale";

describe("RatingScale", () => {
  it("renders a labelled rating control", () => {
    const view = renderComponent(
      <RatingScale onChange={() => undefined} value={3} />,
    );
    expect(view.getByRole("combobox", { name: "Choose a rating" })).toHaveValue(
      "3",
    );
  });

  it("shows the unselected state", () => {
    const view = renderComponent(
      <RatingScale onChange={() => undefined} value={null} />,
    );
    expect(view.getByRole("combobox", { name: "Choose a rating" })).toHaveValue(
      "",
    );
  });

  it("reports the selected rating", () => {
    const onChange = vi.fn();
    renderComponent(<RatingScale onChange={onChange} value={null} />);
    fill("Choose a rating", "5");
    expect(onChange).toHaveBeenCalledWith(5);
  });
});
