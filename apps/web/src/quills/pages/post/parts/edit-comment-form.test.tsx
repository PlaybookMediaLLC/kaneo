import { describe, expect, it, vi } from "vite-plus/test";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { EditCommentForm } from "./edit-comment-form";

describe("EditCommentForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(
        <EditCommentForm
          workspaceId="workspace_test_1"
          viewer={{ kind: "user", id: "user_test_1" }}
          content="Current comment"
          onSubmit={onSubmit}
        />,
      ),
    fieldName: /Comment|post\.comment/,
    issuePath: "content",
    submitName: /Save comment|post\.saveComment/,
    validValue: "Updated comment",
    expectedValues: { attachmentIds: [], content: "Updated comment" },
    invalidValue: "",
  });
  it("starts with the current comment", () => {
    const view = renderComponent(
      <EditCommentForm
        workspaceId="workspace_test_1"
        viewer={{ kind: "user", id: "user_test_1" }}
        content="Current comment"
        onSubmit={vi.fn()}
      />,
    );
    expect(view.getByLabelText("Comment")).toHaveValue("Current comment");
    expect(
      view.getByRole("button", { name: "Save comment" }),
    ).toBeInTheDocument();
  });
});
