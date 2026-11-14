import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { SuggestionList } from "./suggestion-list";

describe("SuggestionList", () => {
  it("shows the heading, the status filter, the last result and the list", async () => {
    const onStatusChange = vi.fn();
    const view = renderComponent(
      <SuggestionList
        status="pending"
        onStatusChange={onStatusChange}
        message="Dismissed: “Dark theme” and “Dark mode”."
      >
        <p>Pairs</p>
      </SuggestionList>,
    );
    expect(
      view.getByRole("heading", { level: 1, name: "Duplicates" }),
    ).toBeInTheDocument();
    expect(view.getByRole("status")).toHaveTextContent(
      "Dismissed: “Dark theme” and “Dark mode”.",
    );
    expect(view.getByText("Pairs")).toBeInTheDocument();
    press("Filters");
    expect(
      await view.findByRole("menuitemradio", { name: "Pending" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      view.getByRole("group", { name: "Suggestions to show" }),
    ).toBeInTheDocument();
    fireEvent.click(view.getByRole("menuitemradio", { name: "Dismissed" }));
    expect(onStatusChange).toHaveBeenCalledWith("dismissed");
  });

  it("names the view of the dismissed pairs", () => {
    const view = renderComponent(
      <SuggestionList
        status="dismissed"
        onStatusChange={() => undefined}
        message=""
      >
        {null}
      </SuggestionList>,
    );
    expect(
      view.getByRole("heading", { level: 1, name: "Dismissed pairs" }),
    ).toBeInTheDocument();
  });
});
