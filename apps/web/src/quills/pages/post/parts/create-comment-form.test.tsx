import { describe, expect, it, vi } from "vite-plus/test";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { CreateCommentForm } from "./create-comment-form";

describe("CreateCommentForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(<CreateCommentForm onSubmit={onSubmit} />),
    fieldName: /Comment|post\.comment/,
    issuePath: "content",
    submitName: /Post comment|post\.submit/,
    validValue: "This would help our team.",
    expectedValues: { content: "This would help our team." },
    invalidValue: "",
  });
  it("renders a labelled comment field", () => {
    const view = renderComponent(<CreateCommentForm onSubmit={vi.fn()} />);
    expect(view.getByLabelText("Comment")).toBeInTheDocument();
    expect(
      view.getByRole("button", { name: "Post comment" }),
    ).toBeInTheDocument();
  });
});
