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

it("puts the rail after the title and shows the description and actions", () => {
  const view = renderComponent(
    <PageFrame
      titleKey="core.gallery.title"
      description="Short summary"
      actions={<button type="button">Subscribe</button>}
      aside={<nav aria-label="Boards" />}
    >
      content
    </PageFrame>,
  );
  const heading = view.getByRole("heading", { level: 1 });
  const rail = view.getByRole("navigation", { name: "Boards" });
  expect(
    heading.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(view.getByText("Short summary")).toBeInTheDocument();
  expect(view.getByRole("button", { name: "Subscribe" })).toBeInTheDocument();
  expect(view.getByRole("main")).toHaveClass("max-w-5xl");
});
