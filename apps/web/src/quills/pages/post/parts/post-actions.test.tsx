import { describe, expect, it } from "vite-plus/test";
import { getPortalPostFixture } from "../../../api/feedback/get-portal-post.fixture";
import { renderComponent } from "../../../test/render";
import { PostActions } from "./post-actions";

describe("PostActions", () => {
  it("shows only server-approved post actions", () => {
    const view = renderComponent(
      <PostActions
        post={getPortalPostFixture.ok({
          canEdit: true,
          canDelete: false,
          canComment: false,
        })}
        comments={[]}
        postId="post_test_1"
        workspaceId="workspace_test_1"
        viewer={{ kind: "user", id: "account_test_1" }}
      />,
    );
    expect(view.getByRole("button", { name: "Edit post" })).toBeInTheDocument();
    expect(
      view.queryByRole("button", { name: "Delete post" }),
    ).not.toBeInTheDocument();
  });
});
