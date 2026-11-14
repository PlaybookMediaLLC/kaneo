import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { MenuItem, ShortcutListener } from "../upstream";
import { ListHeader } from "./list-header";

describe("ListHeader", () => {
  it("shows the heading and runs the filter handler by button and by key", () => {
    const onFilters = vi.fn();
    const view = renderComponent(
      <>
        <ShortcutListener />
        <ListHeader title="Requests" onFilters={onFilters} />
      </>,
    );
    expect(
      view.getByRole("heading", { level: 1, name: "Requests" }),
    ).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Filters" })).toHaveAttribute(
      "aria-keyshortcuts",
      "F",
    );
    press("Filters");
    fireEvent.keyDown(document.body, { key: "f", code: "KeyF" });
    expect(onFilters).toHaveBeenCalledTimes(2);
  });

  it("opens the filter menu with F", async () => {
    const view = renderComponent(
      <>
        <ShortcutListener />
        <ListHeader
          title="Open"
          filters={<MenuItem onClick={() => undefined}>Snoozed</MenuItem>}
        />
      </>,
    );
    fireEvent.keyDown(document.body, { key: "f", code: "KeyF" });
    expect(
      await view.findByRole("menuitem", { name: "Snoozed" }),
    ).toBeInTheDocument();
  });

  it("leaves out the filter button without filters and shows extra actions", () => {
    const view = renderComponent(
      <ListHeader
        title="Tickets"
        headingLevel={2}
        actions={<button type="button">New</button>}
      />,
    );
    expect(
      view.getByRole("heading", { level: 2, name: "Tickets" }),
    ).toBeVisible();
    expect(view.queryByRole("button", { name: "Filters" })).toBeNull();
    expect(view.getByRole("button", { name: "New" })).toBeInTheDocument();
  });
});
