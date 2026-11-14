import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createPortalCommentFixture } from "../../../api/feedback/create-portal-comment.fixture";
import { listPortalPostCommentsFixture } from "../../../api/feedback/list-portal-post-comments.fixture";
import { setPortalCommentReactionFixture } from "../../../api/feedback/set-portal-comment-reaction.fixture";
import { translatePortalContentFixture } from "../../../api/feedback/translate-portal-content.fixture";
import { press } from "../../../test/actions";
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
  afterEach(() => vi.restoreAllMocks());

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
        open
        count={2}
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

  it("shows a new reply under its parent before the pages reload it", async () => {
    const api = mockApi();
    api.reply(
      createPortalCommentFixture.ok({
        id: "comment_test_3",
        parentId: "comment_test_1",
        content: "A fresh reply",
      }),
    );
    const view = renderComponent(
      <PostCommentsSection
        workspaceId="workspace_test_1"
        postId="post_test_1"
        viewer={{ kind: "user", id: "account_test_1" }}
        canComment
        open
        count={1}
        comments={[parent]}
      />,
    );
    press("Reply");
    fireEvent.change(view.getAllByLabelText("Comment")[1]!, {
      target: { value: "A fresh reply" },
    });
    fireEvent.click(view.getAllByRole("button", { name: "Post comment" })[1]!);
    const parentItem = view.getByText("Top-level idea").closest("li")!;
    await waitFor(() =>
      expect(parentItem).toContainElement(view.getByText("A fresh reply")),
    );
    const [request] = api.calls("createQuillsPortalComment");
    expect(await request!.json()).toMatchObject({
      content: "A fresh reply",
      parentId: "comment_test_1",
    });
  });

  it("asks a visitor to sign in and offers no reply or like", () => {
    const view = renderComponent(
      <PostCommentsSection
        workspaceId="workspace_test_1"
        postId="post_test_1"
        viewer={{ kind: "anonymous" }}
        canComment
        open
        count={1}
        comments={[parent]}
      />,
    );
    expect(
      view.getByRole("link", { name: /sign in to comment/i }),
    ).toHaveAttribute("href", expect.stringContaining("redirect="));
    expect(
      view.queryByRole("button", { name: "Reply" }),
    ).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "Like" })).toBeDisabled();
  });

  it("translates one comment in place for a browser in another language", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("es");
    const api = mockApi();
    api.reply(translatePortalContentFixture.ok({ content: "Idea principal" }));
    const view = renderComponent(
      <PostCommentsSection
        workspaceId="workspace_test_1"
        postId="post_test_1"
        viewer={{ kind: "anonymous" }}
        canComment={false}
        open
        comments={[parent, reply]}
      />,
    );
    view.getAllByRole("button", { name: "Translate" })[0]!.click();
    expect(await view.findByText("Idea principal")).toBeInTheDocument();
    expect(view.getByText("A reply below it")).toBeInTheDocument();
    const [request] = api.calls("translateQuillsPortalContent");
    expect(await request!.json()).toEqual({
      commentId: "comment_test_1",
      locale: "es",
    });
  });
});
