import { describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, waitFor } from "@testing-library/react";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { BoardSegments } from "./board-segments";

const segments = [
  { id: "segment_test_1", name: "Enterprise" },
  { id: "segment_test_2", name: "Beta" },
];

describe("BoardSegments", () => {
  it("sends the chosen segments, and an empty list to show the board to all", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = renderComponent(
      <BoardSegments
        board={{ name: "Ideas", visibleSegmentIds: ["segment_test_2"] }}
        segments={segments}
        onSubmit={onSubmit}
      />,
    );
    expect(
      view.getByRole("group", { name: "Segments that can see Ideas" }),
    ).toBeVisible();
    expect(view.getByRole("checkbox", { name: "Beta" })).toBeChecked();
    fireEvent.click(view.getByRole("checkbox", { name: "Enterprise" }));
    press("Save visibility");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith([
        "segment_test_2",
        "segment_test_1",
      ]),
    );
    expect(await view.findByRole("status")).toHaveTextContent(
      "The visibility is saved.",
    );
    fireEvent.click(view.getByRole("checkbox", { name: "Enterprise" }));
    fireEvent.click(view.getByRole("checkbox", { name: "Beta" }));
    expect(
      view.getByText(/every customer that the board allows/),
    ).toBeVisible();
    press("Save visibility");
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith([]));
  });

  it("shows the choice without a save control when the teammate cannot manage settings", () => {
    const view = renderComponent(
      <BoardSegments
        board={{ name: "Ideas", visibleSegmentIds: ["segment_test_1"] }}
        segments={segments}
      />,
    );
    expect(view.getByRole("checkbox", { name: "Enterprise" })).toBeChecked();
    expect(view.getByRole("checkbox", { name: "Enterprise" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(view.queryByRole("button", { name: "Save visibility" })).toBeNull();
  });

  it("asks for a segment when the workspace has none", () => {
    const view = renderComponent(
      <BoardSegments
        board={{ name: "Ideas", visibleSegmentIds: null }}
        segments={[]}
        onSubmit={vi.fn()}
      />,
    );
    expect(view.getByText(/Create a segment/)).toBeVisible();
  });
});
