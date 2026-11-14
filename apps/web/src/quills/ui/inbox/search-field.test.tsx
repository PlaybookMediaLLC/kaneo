import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { ShortcutListener } from "../upstream";
import { SearchField } from "./search-field";

describe("SearchField", () => {
  it("is a named search box that reports each change", () => {
    const onChange = vi.fn();
    const view = renderComponent(
      <SearchField label="Search requests…" value="" onChange={onChange} />,
    );
    const field = view.getByRole("searchbox", { name: "Search requests…" });
    expect(field).toHaveAttribute("aria-keyshortcuts", "/");
    fireEvent.change(field, { target: { value: "export" } });
    expect(onChange).toHaveBeenCalledWith("export");
  });

  it("takes the focus on / and gives it up on Escape", () => {
    const view = renderComponent(
      <>
        <ShortcutListener />
        <SearchField label="Search" value="" onChange={() => undefined} />
      </>,
    );
    const field = view.getByRole("searchbox", { name: "Search" });
    fireEvent.keyDown(document.body, { key: "/" });
    expect(field).toHaveFocus();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field).not.toHaveFocus();
  });

  it("has no key hint when the shortcut is off", () => {
    const view = renderComponent(
      <SearchField
        label="Search"
        value=""
        onChange={() => undefined}
        shortcut={false}
      />,
    );
    expect(view.getByRole("searchbox")).not.toHaveAttribute(
      "aria-keyshortcuts",
    );
  });
});
