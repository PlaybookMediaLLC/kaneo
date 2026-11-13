import { expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { DeleteCommentSheet } from "./delete-comment-sheet";
it("does not delete a comment merely by opening its confirmation", () => {
  const confirm = vi.fn();
  const view = renderComponent(
    <DeleteCommentSheet
      open
      problem={null}
      onRetry={() => {}}
      onClose={() => {}}
      onConfirm={confirm}
    />,
  );
  expect(view.getByRole("dialog")).toHaveAccessibleName("Delete comment");
  expect(confirm).not.toHaveBeenCalled();
});
