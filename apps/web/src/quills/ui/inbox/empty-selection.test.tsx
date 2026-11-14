import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { EmptySelection } from "./empty-selection";

describe("EmptySelection", () => {
  it("shows the title and the text", () => {
    const view = renderComponent(
      <EmptySelection
        title="No conversation selected"
        text="Open a thread to read and reply."
      />,
    );
    expect(
      view.getByRole("heading", { name: "No conversation selected" }),
    ).toBeVisible();
    expect(view.getByText("Open a thread to read and reply.")).toBeVisible();
  });
});
