import { describe, expect, it, vi } from "vite-plus/test";
import { describeFormContract } from "../../../test/contracts";
import { choose, fill, press } from "../../../test/actions";
import { waitFor } from "@testing-library/react";
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
  it("keeps the selected board in the form", () => {
    const view = renderComponent(
      <SubmitPostForm
        boards={[{ id: "board_test_1", name: "Ideas" }]}
        defaultBoardId="board_test_1"
        workspaceId="workspace_test_1"
        viewer={{ kind: "anonymous" }}
        onSubmit={vi.fn()}
      />,
    );
    expect(view.getByLabelText("Board")).toHaveTextContent("Ideas");
    expect(view.getByLabelText("Title")).toBeInTheDocument();
    expect(view.getByLabelText("Details")).toBeInTheDocument();
  });
});

it("submits the selected board instead of the initial board", async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  renderComponent(
    <SubmitPostForm
      boards={[
        { id: "board_test_1", name: "Ideas" },
        { id: "board_test_2", name: "Bugs" },
      ]}
      workspaceId="workspace_test_1"
      viewer={{ kind: "anonymous" }}
      onSubmit={onSubmit}
    />,
  );
  await choose("Board", "Bugs");
  fill("Details", "The selected board should receive this feedback");
  press("Submit feedback");
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: "board_test_2" }),
    ),
  );
});
