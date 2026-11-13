import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { listPortalPostCommentsFixture } from "../../../api/feedback/list-portal-post-comments.fixture";
import { setPortalCommentReactionFixture } from "../../../api/feedback/set-portal-comment-reaction.fixture";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { PostCommentsSection } from "./post-comments-section";

const parent = listPortalPostCommentsFixture.comment({
  id: "comment_test_1",
  content: "Top-level idea",
});
const reply = listPortalPostCommentsFixture.comment({
  id: "comment_test_2",
  parentId: "comment_test_1",
  content: "A reply below it",
});

describe("PostCommentsSection", () => {
  it("threads replies under their parent and likes a comment", async () => {
    const api = mockApi();
    api.reply(setPortalCommentReactionFixture.ok());
    api.reply(listPortalPostCommentsFixture.ok());
    const view = renderComponent(
      <PostCommentsSection
        workspaceId="workspace_test_1"
        postId="post_test_1"
        viewer={{ kind: "user", id: "account_test_1" }}
        canComment
        comments={[parent, reply]}
      />,
    );
    expect(
      view.getByRole("heading", { name: "2 comments" }),
    ).toBeInTheDocument();
    const parentItem = view.getByText("Top-level idea").closest("li")!;
    expect(parentItem).toContainElement(view.getByText("A reply below it"));
    view.getAllByRole("button", { name: "Like" })[0]!.click();
    await waitFor(() =>
      expect(api.calls("setQuillsPortalCommentReaction")).toHaveLength(1),
    );
    const [request] = api.calls("setQuillsPortalCommentReaction");
    expect(await request!.json()).toEqual({ emoji: "❤️", reacted: true });
  });

  it("asks a visitor to sign in and offers no reply or like", () => {
    const view = renderComponent(
      <PostCommentsSection
        workspaceId="workspace_test_1"
        postId="post_test_1"
        viewer={{ kind: "anonymous" }}
        canComment
        comments={[parent]}
      />,
    );
    expect(view.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      expect.stringContaining("redirect="),
    );
    expect(
      view.queryByRole("button", { name: "Reply" }),
    ).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "Like" })).toBeDisabled();
  });
});
