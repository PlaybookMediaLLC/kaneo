import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { DetailHeader } from "./detail-header";

describe("DetailHeader", () => {
  it("shows the left side, the actions, back and the arrows", () => {
    const onBack = vi.fn();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const view = renderComponent(
      <DetailHeader
        onBack={onBack}
        backLabel="Feature requests"
        onPrevious={onPrevious}
        onNext={onNext}
        actions={<button type="button">Merge</button>}
      >
        <h1>Dark mode</h1>
      </DetailHeader>,
    );
    expect(view.getByRole("heading", { name: "Dark mode" })).toBeVisible();
    expect(
      view.getByRole("button", { name: "Back to Feature requests" }),
    ).toHaveTextContent("Feature requests");
    press("Back to Feature requests");
    press("Previous");
    press("Next");
    expect(
      [onBack, onPrevious, onNext].map((f) => f.mock.calls.length),
    ).toEqual([1, 1, 1]);
    expect(view.getByRole("button", { name: "Next" })).toHaveAttribute(
      "aria-keyshortcuts",
      "J",
    );
    expect(view.getByRole("button", { name: "Merge" })).toBeVisible();
  });

  it("has no back, arrows or panel toggle without handlers and a layout", () => {
    const view = renderComponent(<DetailHeader>{null}</DetailHeader>);
    expect(view.queryAllByRole("button")).toHaveLength(0);
  });
});
