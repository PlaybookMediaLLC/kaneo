import { expect, it } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { listPortalPostCommentsFixture } from "../../../api/feedback/list-portal-post-comments.fixture";
import { EditCommentSheet } from "./edit-comment-sheet";
it("retains the selected comment draft in its accessible sheet", () => {
  const view = renderComponent(
    <EditCommentSheet
      workspaceId="workspace_test_1"
      viewer={{ kind: "user", id: "user_1" }}
      comment={listPortalPostCommentsFixture.comment()}
      onClose={() => {}}
      onSubmit={async () => {}}
    />,
  );
  expect(view.getByRole("dialog")).toHaveAccessibleName("Edit comment");
  expect(view.getByRole("textbox")).toHaveValue("A useful reply");
});
