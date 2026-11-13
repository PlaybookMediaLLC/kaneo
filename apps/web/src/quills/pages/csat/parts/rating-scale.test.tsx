import { describe, expect, it, vi } from "vite-plus/test";
import { choose } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { RatingScale } from "./rating-scale";

describe("RatingScale", () => {
  it("renders a labelled rating control", () => {
    const view = renderComponent(
      <RatingScale onChange={() => undefined} value={3} />,
    );
    expect(
      view.getByRole("combobox", { name: "Choose a rating" }),
    ).toHaveTextContent("3 out of 5");
  });

  it("shows the unselected state", () => {
    const view = renderComponent(
      <RatingScale onChange={() => undefined} value={null} />,
    );
    expect(
      view.getByRole("combobox", { name: "Choose a rating" }),
    ).toHaveTextContent("Choose a rating");
  });

  it("reports the selected rating", async () => {
    const onChange = vi.fn();
    renderComponent(<RatingScale onChange={onChange} value={null} />);
    await choose("Choose a rating", "Rating 5 out of 5");
    expect(onChange).toHaveBeenCalledWith(5);
  });
});
