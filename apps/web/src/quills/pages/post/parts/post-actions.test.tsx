import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { PostActions } from "./post-actions";

const props = {
  post: {
    title: "Export history",
    content: "Please add exports",
    attachments: [],
  },
  postId: "post_test_1",
  workspaceId: "workspace_test_1",
  viewer: { kind: "user" as const, id: "account_test_1" },
  onEditOpenChange: vi.fn(),
  onDeleteOpenChange: vi.fn(),
};

describe("PostActions", () => {
  it("opens the edit sheet with the current post", async () => {
    const view = renderComponent(
      <PostActions {...props} editOpen deleteOpen={false} />,
    );
    expect(
      await view.findByRole("dialog", { name: "Edit post" }),
    ).toBeInTheDocument();
    expect(view.getByDisplayValue("Export history")).toBeInTheDocument();
  });

  it("asks to confirm a delete", async () => {
    const view = renderComponent(
      <PostActions {...props} editOpen={false} deleteOpen />,
    );
    expect(
      await view.findByRole("button", {
        name: "Delete this post permanently?",
      }),
    ).toBeInTheDocument();
  });
});
