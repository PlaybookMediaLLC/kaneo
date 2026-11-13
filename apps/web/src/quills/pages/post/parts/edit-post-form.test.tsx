import { describe, expect, it, vi } from "vite-plus/test";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { EditPostForm } from "./edit-post-form";

describe("EditPostForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(
        <EditPostForm
          title="Export history"
          content="Please add exports"
          onSubmit={onSubmit}
        />,
      ),
    fieldName: /Title|feedback\.postTitle/,
    issuePath: "title",
    submitName: /Save post|post\.savePost/,
    validValue: "Export activity history",
    expectedValues: {
      title: "Export activity history",
      content: "Please add exports",
    },
    invalidValue: "",
  });
  it("starts with the current post values", () => {
    const view = renderComponent(
      <EditPostForm
        title="Export history"
        content="Please add exports"
        onSubmit={vi.fn()}
      />,
    );
    expect(view.getByLabelText("Title")).toHaveValue("Export history");
    expect(view.getByLabelText("Details")).toHaveValue("Please add exports");
  });
});
