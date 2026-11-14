import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { ListPane } from "./list-pane";

describe("ListPane", () => {
  it("shows the header, the search field and the rows", () => {
    const onChange = vi.fn();
    const view = renderComponent(
      <ListPane
        title="Open"
        actions={<button type="button">Queue</button>}
        search={{ label: "Search conversations…", value: "", onChange }}
      >
        <ul aria-label="Rows">
          <li>Ada</li>
        </ul>
      </ListPane>,
    );
    expect(view.getByRole("heading", { level: 1, name: "Open" })).toBeVisible();
    expect(view.getByRole("button", { name: "Queue" })).toBeVisible();
    fireEvent.change(
      view.getByRole("searchbox", { name: "Search conversations…" }),
      { target: { value: "ada" } },
    );
    expect(onChange).toHaveBeenCalledWith("ada");
    expect(view.getByRole("list", { name: "Rows" })).toHaveTextContent("Ada");
    expect(view.queryByRole("button", { name: "Hide the list" })).toBeNull();
  });

  it("shows the loading, empty and error states instead of the rows", () => {
    const rows = <p>Rows</p>;
    const view = renderComponent(
      <ListPane title="Open" loading>
        {rows}
      </ListPane>,
    );
    expect(view.getByText("Loading…")).toBeVisible();
    view.rerender(
      <ListPane title="Open" empty>
        {rows}
      </ListPane>,
    );
    expect(view.getByRole("status")).toHaveTextContent("Nothing is here yet.");
    expect(view.queryByText("Rows")).toBeNull();
    view.rerender(
      <ListPane title="Open" problem={{ kind: "failed" }} onRetry={() => {}}>
        {rows}
      </ListPane>,
    );
    expect(view.getByRole("alert")).toBeVisible();
    expect(view.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
