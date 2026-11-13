import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { PostDetail } from "./post-detail";
describe("PostDetail", () => {
  it("renders the post and treats rich content as editor content", () => {
    const view = renderComponent(
      <PostDetail
        post={{
          title: "Safer exports",
          content: "**Formatted detail**",
          author: { name: "Ari" },
          board: { name: "Ideas" },
          status: { name: "Planned" },
          pending: true,
          mergedInto: null,
        }}
      />,
    );
    expect(view.getByText("Safer exports")).toBeInTheDocument();
    expect(view.getByText("Formatted detail")).toBeInTheDocument();
    expect(view.getByRole("status")).toHaveTextContent(/waiting for review/i);
  });
});
