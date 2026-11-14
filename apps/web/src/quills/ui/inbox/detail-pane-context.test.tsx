import { useContext } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { DetailPaneContext } from "./detail-pane-context";

function Probe() {
  const pane = useContext(DetailPaneContext);
  return (
    <button type="button" onClick={pane?.hideList}>
      {pane ? "Hide" : "None"}
    </button>
  );
}

describe("DetailPaneContext", () => {
  it("is empty outside a DetailLayout and gives the pane controls inside it", () => {
    const view = renderComponent(<Probe />);
    expect(view.getByRole("button")).toHaveTextContent("None");
    const hideList = vi.fn();
    view.rerender(
      <DetailPaneContext.Provider value={{ hideList, panel: null }}>
        <Probe />
      </DetailPaneContext.Provider>,
    );
    view.getByRole("button", { name: "Hide" }).click();
    expect(hideList).toHaveBeenCalledOnce();
  });
});
