import { expect, it, vi } from "vite-plus/test";
import { fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/render";
import { BoardIntro } from "./board-intro";
const board = {
  id: "board_1",
  name: "Ideas",
  slug: "ideas",
  description: "Share ideas",
  postCount: 3,
  canSubmit: true,
  canVote: true,
  canComment: true,
};
it("opens submission for a permitted member", () => {
  const onSubmit = vi.fn();
  const view = renderComponent(
    <BoardIntro
      workspaceId="workspace_1"
      board={board}
      viewerKind="user"
      onSubmit={onSubmit}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Submit feedback" }));
  expect(onSubmit).toHaveBeenCalledOnce();
});
it("retains the board return path for guests", () => {
  const view = renderComponent(
    <BoardIntro
      workspaceId="workspace_1"
      board={board}
      viewerKind="anonymous"
      onSubmit={() => {}}
    />,
  );
  expect(view.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/auth/sign-in?redirect=%2Fportal%2Fworkspace_1%2Fboards%2Fboard_1",
  );
  expect(view.queryByRole("button")).not.toBeInTheDocument();
});
it("does not offer submission when the board disallows it", () => {
  const view = renderComponent(
    <BoardIntro
      workspaceId="workspace_1"
      board={{ ...board, canSubmit: false }}
      viewerKind="user"
      onSubmit={() => {}}
    />,
  );
  expect(view.queryByRole("button")).not.toBeInTheDocument();
});
