import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { ActionProblem } from "./action-problem";

describe("ActionProblem", () => {
  it("shows nothing without a problem", () => {
    const view = renderComponent(<ActionProblem problem={null} />);
    expect(view.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains a conflict and a general failure", () => {
    const view = renderComponent(
      <ActionProblem problem={{ kind: "conflict" }} />,
    );
    expect(view.getByRole("alert")).toHaveTextContent(/required/i);
    view.rerender(<ActionProblem problem={{ kind: "failed" }} />);
    expect(view.getByRole("alert")).toHaveTextContent(/could not/i);
  });
});
