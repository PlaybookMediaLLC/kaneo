import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { ShortcutListener } from "../upstream";
import { DetailLayout } from "./detail-layout";

function renderDetail(activeId = "b") {
  const onMove = vi.fn();
  const onBack = vi.fn();
  const view = renderComponent(
    <>
      <ShortcutListener />
      <DetailLayout
        list={<p>Compact list</p>}
        listLabel="Conversations"
        ids={["a", "b", "c"]}
        activeId={activeId}
        onMove={onMove}
        onBack={onBack}
        properties={<p>Status: open</p>}
        propertiesLabel="Details"
      >
        <h1>Export fails</h1>
      </DetailLayout>
    </>,
  );
  return { view, onMove, onBack };
}

describe("DetailLayout", () => {
  it("shows the compact list, the item and the properties in named panes", () => {
    const { view } = renderDetail();
    expect(
      view.getByRole("region", { name: "Conversations" }),
    ).toHaveTextContent("Compact list");
    expect(view.getByRole("heading", { name: "Export fails" })).toBeVisible();
    expect(
      view.getByRole("complementary", { name: "Details" }),
    ).toHaveTextContent("Status: open");
  });

  it("moves to the previous and next item and goes back, by button and by key", () => {
    const { view, onMove, onBack } = renderDetail();
    press("Previous");
    press("Next");
    expect(onMove.mock.calls).toEqual([["a"], ["c"]]);
    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    expect(onMove.mock.calls.slice(2)).toEqual([["c"], ["a"]]);
    press("Back to the list");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(view.getByRole("button", { name: "Next" })).toHaveAttribute(
      "aria-keyshortcuts",
      "J",
    );
  });

  it("opens the properties in a sheet on small screens", async () => {
    const { view } = renderDetail();
    press("Details");
    const sheet = await view.findByRole("dialog", { name: "Details" });
    expect(sheet).toHaveTextContent("Status: open");
  });
});
