import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { StatusTabs } from "./status-tabs";

const tabs = [
  { value: "open", label: "Open", count: 4 },
  { value: "snoozed", label: "Snoozed", count: 0 },
  { value: "all", label: "All" },
];

describe("StatusTabs", () => {
  it("marks the current status, shows counts and reports a new choice", () => {
    const onChange = vi.fn();
    const view = renderComponent(
      <StatusTabs
        label="Status"
        tabs={tabs}
        value="open"
        onChange={onChange}
      />,
    );
    expect(view.getByRole("tablist", { name: "Status" })).toBeInTheDocument();
    expect(view.getByRole("tab", { name: "Open 4" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(view.getByRole("tab", { name: "Snoozed 0" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    fireEvent.click(view.getByRole("tab", { name: "All" }));
    expect(onChange).toHaveBeenCalledWith("all");
  });
});
