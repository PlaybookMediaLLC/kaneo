import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { SignalList } from "./signal-list";

describe("SignalList", () => {
  it("shows the heading, the status filter, the last result and the list", async () => {
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
    expect(view.getByRole("status")).toHaveTextContent(
      "Dismissed: “Dark theme”.",
    );
    expect(view.getByText("Signals")).toBeInTheDocument();
    press("Filters");
    expect(
      await view.findByRole("menuitemradio", { name: "Pending" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      view.getByRole("group", { name: "Signals to show" }),
    ).toBeInTheDocument();
    fireEvent.click(view.getByRole("menuitemradio", { name: "Dismissed" }));
    expect(onStatusChange).toHaveBeenCalledWith("dismissed");
  });

  it("names the view after a status other than pending", () => {
    const view = renderComponent(
      <SignalList
        status="dismissed"
        onStatusChange={() => undefined}
        message=""
      >
        {null}
      </SignalList>,
    );
    expect(
      view.getByRole("heading", { level: 1, name: "Dismissed signals" }),
    ).toBeInTheDocument();
  });
});
