import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { MarkdownContent } from "./markdown-content";

describe("MarkdownContent", () => {
  it("renders Markdown without an authenticated app router and preserves the page heading", () => {
    const view = renderComponent(
      <MarkdownContent content={"# Details\n\nRead **carefully**."} />,
    );
    expect(
      view.getByRole("heading", { level: 2, name: "Details" }),
    ).toBeInTheDocument();
    expect(view.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(view.getByText("carefully").tagName).toBe("STRONG");
  });
  it("does not create raw HTML or active script links", () => {
    const view = renderComponent(
      <MarkdownContent
        content={
          '<img src="x" onerror="alert(1)">\n\n[Unsafe](javascript:alert(1))'
        }
      />,
    );
    expect(view.queryByRole("img")).not.toBeInTheDocument();
    expect(view.getByText("Unsafe").closest("a")).not.toHaveAttribute(
      "href",
      "javascript:alert(1)",
    );
  });
  it("shows no remote images in customer text, but keeps them in team text", () => {
    const image = "![Chart](https://tracker.example.test/pixel.png)";
    const customer = renderComponent(
      <MarkdownContent customer content={image} />,
    );
    expect(customer.queryByRole("img")).not.toBeInTheDocument();
    customer.unmount();
    const team = renderComponent(<MarkdownContent content={image} />);
    expect(team.getByRole("img", { name: "Chart" })).toBeInTheDocument();
  });
  it("keeps ordinary links accessible", () => {
    const view = renderComponent(
      <MarkdownContent content="[Documentation](https://example.test/docs)" />,
    );
    expect(view.getByRole("link", { name: "Documentation" })).toHaveAttribute(
      "href",
      "https://example.test/docs",
    );
  });
});
