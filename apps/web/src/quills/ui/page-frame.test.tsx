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

it("updates the title without interrupting an active draft", () => {
  const view = renderComponent(
    <PageFrame titleKey="post.title" displayTitle="Original">
      <input aria-label="Comment" />
    </PageFrame>,
  );
  const input = view.getByRole("textbox", { name: "Comment" });
  input.focus();
  view.rerender(
    <PageFrame titleKey="post.title" displayTitle="Renamed">
      <input aria-label="Comment" />
    </PageFrame>,
  );
  expect(document.title).toBe("Renamed");
  expect(input).toHaveFocus();
});
