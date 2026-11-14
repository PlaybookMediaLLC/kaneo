import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { FeedbackFilter } from "./feedback-filter";

describe("FeedbackFilter", () => {
  it("marks the current filter and reports a new one", () => {
    const onChange = vi.fn();
    const view = renderComponent(
      <FeedbackFilter value="all" onChange={onChange} />,
    );
    expect(
      view.getByRole("group", { name: "Show feedback" }),
    ).toBeInTheDocument();
    expect(view.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    press("Following");
    expect(onChange).toHaveBeenCalledWith("following");
  });
});
