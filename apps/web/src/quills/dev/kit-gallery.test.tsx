import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { press } from "../test/actions";
import { KitGallery } from "./kit-gallery";

describe("KitGallery", () => {
  it("shows a visible shell and the kit states with one main heading", () => {
    const view = renderComponent(<KitGallery />);
    expect(view.getByRole("banner")).toBeVisible();
    expect(view.getByRole("contentinfo")).toBeVisible();
    expect(view.getAllByRole("main")).toHaveLength(1);
    expect(view.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(view.getByText("Loading…")).toBeVisible();
    expect(view.getByRole("button", { name: /try again in/i })).toBeDisabled();
  });
  it("switches content states and exercises vote callbacks", async () => {
    const view = renderComponent(<KitGallery />);
    fireEvent.click(view.getByRole("checkbox", { name: "Show empty content" }));
    expect(view.getByText("This comment was deleted.")).toBeVisible();
    press("Vote");
    expect(
      await view.findByRole("button", { name: "Remove vote" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
