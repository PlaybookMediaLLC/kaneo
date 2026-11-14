import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { MyFeedbackRow } from "./my-feedback-row";

const item = {
  id: "post_test_1",
  title: "Dark mode",
  board: { name: "Ideas" },
  status: { name: "Planned" },
  isAuthor: false,
  voted: true,
  following: true,
  lastChangedAt: "2026-01-01T00:00:00.000Z",
};

describe("MyFeedbackRow", () => {
  it("links the post and shows where it stands", () => {
    const view = renderComponent(
      <ul>
        <MyFeedbackRow workspaceId="workspace_test_1" item={item} />
      </ul>,
    );
    expect(view.getByRole("link", { name: "Dark mode" })).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/posts/post_test_1",
    );
    expect(view.getByText("Ideas · Planned")).toBeInTheDocument();
    expect(view.getByText(/^Voted · Following · Changed/)).toBeInTheDocument();
  });

  it("names a post without a status", () => {
    const view = renderComponent(
      <ul>
        <MyFeedbackRow
          workspaceId="workspace_test_1"
          item={{ ...item, status: null, isAuthor: true, voted: false }}
        />
      </ul>,
    );
    expect(view.getByText("Ideas · No status")).toBeInTheDocument();
    expect(view.getByText(/^Shared by you · Following/)).toBeInTheDocument();
  });
});
