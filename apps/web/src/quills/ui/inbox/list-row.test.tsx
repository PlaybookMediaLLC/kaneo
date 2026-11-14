import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { ListRow, type ListRowProps } from "./list-row";

const row: ListRowProps = {
  href: "/feedback/workspace_1/tickets/ticket_1",
  onOpen: () => undefined,
  person: { name: "Ada Customer" },
  shortId: "T-39",
  title: "Export fails",
  preview: "The CSV export stops at row 100.",
  chips: [{ id: "bug", label: "Bug" }],
  time: new Date(Date.now() - 2 * 3_600_000).toISOString(),
};

describe("ListRow", () => {
  it("shows the person, short ID, title, preview, chips, time and assignee", () => {
    const view = renderComponent(
      <ListRow {...row} unread assignee={{ name: "Grace" }} />,
    );
    const link = view.getByRole("link");
    expect(link).toHaveAttribute("href", row.href);
    for (const text of [
      "Ada Customer",
      "T-39",
      "Export fails",
      "The CSV export stops at row 100.",
      "Bug",
      "Unread",
      "Assigned to Grace",
    ])
      expect(link).toHaveTextContent(text);
    expect(view.getByText(/2h ago/)).toHaveAttribute("datetime", row.time);
  });

  it("names an unassigned item and shows no assignee when none is given", () => {
    const view = renderComponent(<ListRow {...row} assignee={null} />);
    expect(view.getByRole("link")).toHaveTextContent("Unassigned");
    view.rerender(<ListRow {...row} />);
    expect(view.getByRole("link")).not.toHaveTextContent("Unassigned");
  });

  it("opens in the app on a plain click and leaves a modified click to the browser", () => {
    const onOpen = vi.fn();
    const view = renderComponent(<ListRow {...row} onOpen={onOpen} />);
    const link = view.getByRole("link");
    expect(fireEvent.click(link)).toBe(false);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("marks and scrolls to the selected row", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const view = renderComponent(<ListRow {...row} selected compact />);
    expect(view.getByRole("link")).toHaveAttribute("aria-current", "true");
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  });
});
