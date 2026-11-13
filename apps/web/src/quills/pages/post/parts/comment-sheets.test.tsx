import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { CommentSheets } from "./comment-sheets";

const props = {
  workspaceId: "workspace_test_1",
  viewer: { kind: "user" as const, id: "account_test_1" },
  onEditDone: vi.fn(),
  onDeleteDone: vi.fn(),
};

describe("CommentSheets", () => {
  it("opens the edit sheet for the chosen comment", async () => {
    const view = renderComponent(
      <CommentSheets
        {...props}
        comment={{
          id: "comment_test_1",
          content: "Earlier text",
          attachments: [],
        }}
        deleteId={null}
      />,
    );
    expect(
      await view.findByRole("dialog", { name: "Edit comment" }),
    ).toBeInTheDocument();
    expect(view.getByDisplayValue("Earlier text")).toBeInTheDocument();
  });

  it("asks to confirm a comment delete", async () => {
    const view = renderComponent(
      <CommentSheets {...props} deleteId="comment_test_1" />,
    );
    expect(
      await view.findByRole("button", {
        name: "Delete this comment permanently?",
      }),
    ).toBeInTheDocument();
  });
});
