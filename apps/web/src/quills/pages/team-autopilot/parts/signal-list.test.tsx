import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { SignalList } from "./signal-list";

describe("SignalList", () => {
  it("shows the heading, the status tabs, the last result and the list", () => {
    const onStatusChange = vi.fn();
    const view = renderComponent(
      <SignalList
        status="pending"
        onStatusChange={onStatusChange}
        message="Dismissed: “Dark theme”."
      >
        <p>Signals</p>
      </SignalList>,
    );
    expect(
      view.getByRole("heading", { level: 1, name: "Autopilot" }),
    ).toBeInTheDocument();
    expect(view.getByRole("tab", { name: "Pending" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(view.getByRole("status")).toHaveTextContent(
      "Dismissed: “Dark theme”.",
    );
    expect(view.getByText("Signals")).toBeInTheDocument();
    fireEvent.click(view.getByRole("tab", { name: "Dismissed" }));
    expect(onStatusChange).toHaveBeenCalledWith("dismissed");
  });
});
