import { describe, expect, it } from "vite-plus/test";
import { PageFrame } from "./page-frame";
import { renderComponent } from "../test/render";

describe("PageFrame", () => {
  it("sets the title and one main heading", () => {
    const view = renderComponent(
      <PageFrame titleKey="core.gallery.title">content</PageFrame>,
    );
    expect(view.getByRole("main")).toBeInTheDocument();
    expect(view.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
