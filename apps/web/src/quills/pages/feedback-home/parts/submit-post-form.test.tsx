import { describe, expect, it, vi } from "vite-plus/test";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { SubmitPostForm } from "./submit-post-form";

describe("SubmitPostForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(
        <SubmitPostForm
          boards={[{ id: "board_test_1", name: "Ideas" }]}
          defaultBoardId="board_test_1"
          workspaceId="workspace_test_1"
          viewer={{ kind: "anonymous" }}
          onSubmit={onSubmit}
        />,
      ),
    fieldName: /Details|feedback\.content/,
    issuePath: "content",
    submitName: /Submit feedback|feedback\.submit/,
    validValue: "Export activity history",
    invalidValue: "",
    expectedValues: {
      boardId: "board_test_1",
      title: undefined,
      content: "Export activity history",
    },
  });
  it("renders labelled submission fields", () => {
    const view = renderComponent(
      <SubmitPostForm
        boards={[{ id: "board_test_1", name: "Ideas" }]}
        workspaceId="workspace_test_1"
        viewer={{ kind: "anonymous" }}
        onSubmit={vi.fn()}
      />,
    );
    expect(view.getByLabelText("Board")).toBeInTheDocument();
    expect(view.getByLabelText("Title")).toBeInTheDocument();
    expect(view.getByLabelText("Details")).toBeInTheDocument();
    expect(
      view.getByRole("button", { name: "Submit feedback" }),
    ).toBeInTheDocument();
  });
});
