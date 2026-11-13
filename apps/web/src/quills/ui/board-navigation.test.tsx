import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { BoardNavigation } from "./board-navigation";

describe("BoardNavigation", () => {
  it("links each board with its count", () => {
    const view = renderComponent(
      <BoardNavigation
        workspaceId="workspace_test_1"
        boards={[
          {
            id: "board_test_1",
            name: "Ideas",
            postCount: 3,
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

it("marks only the selected board and preserves workspace links", () => {
  const view = renderComponent(
    <BoardNavigation
      workspaceId="workspace_1"
      boardId="board_1"
      boards={[
        {
          id: "board_1",
          name: "Ideas",
          postCount: 3,
        },
      ]}
    />,
  );
  expect(view.getByRole("link", { name: /Ideas/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(view.getByRole("link", { name: "All feedback" })).toHaveAttribute(
    "href",
    "/portal/workspace_1",
  );
  expect(view.getByRole("link", { name: "All feedback" })).not.toHaveAttribute(
    "aria-current",
  );
});
