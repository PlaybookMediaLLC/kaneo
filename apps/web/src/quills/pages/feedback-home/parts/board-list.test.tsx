import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { BoardList } from "./board-list";

describe("BoardList", () => {
  it("links each board with its count", () => {
    const view = renderComponent(
      <BoardList
        workspaceId="workspace_test_1"
        boards={[
          {
            id: "board_test_1",
            name: "Ideas",
            slug: "ideas",
            description: "Share ideas",
            postCount: 3,
            canSubmit: true,
            canVote: true,
            canComment: true,
          },
        ]}
      />,
    );
    expect(view.getByRole("heading", { name: "Boards" })).toBeInTheDocument();
    expect(view.getByRole("link", { name: /ideas/i })).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/boards/board_test_1",
    );
    expect(view.getByText("3 posts")).toBeInTheDocument();
  });
});
