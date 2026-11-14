import { describe, expect, it } from "vite-plus/test";
import { findPortalSimilarPostsFixture } from "../../api/feedback/find-portal-similar-posts.fixture";
import { getPortalPostFixture } from "../../api/feedback/get-portal-post.fixture";
import { listPortalPostCommentsFixture } from "../../api/feedback/list-portal-post-comments.fixture";
import { setPortalVoteFixture } from "../../api/feedback/set-portal-vote.fixture";
import { createPortalCommentFixture } from "../../api/feedback/create-portal-comment.fixture";
import { fill, press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { PostPage } from "./post-page";
describe("PostPage", () => {
  const options = { params: { postId: "post_test_1" } };
  const preparePost = (voted = false) => {
    const api = mockApi();
    api.reply(
      getPortalPostFixture.ok({
        id: "post_test_1",
        title: "Export history",
        voted,
        voteCount: voted ? 2 : 1,
        canVote: true,
      }),
    );
    api.reply(listPortalPostCommentsFixture.ok());
    api.reply(findPortalSimilarPostsFixture.ok());
    return api;
  };
  describePageContract(meta, PostPage, {
    loading: {
      prepare: () => {
        mockApi().defer(() => undefined);
        return options;
      },
    },
    failed: {
      prepare: () => {
        mockApi().fail();
        return options;
      },
    },
    ready: {
      prepare: () => {
        preparePost();
        return options;
      },
      assert: async (view) => {
        await view.findByText("Export history");
      },
    },
    done: {
      prepare: () => {
        const api = preparePost();
        api.reply(
          setPortalVoteFixture.ok({
            postId: "post_test_1",
            voted: true,
            voteCount: 2,
            changed: true,
          }),
        );
        api.reply(
          getPortalPostFixture.ok({
            id: "post_test_1",
            title: "Export history",
            voted: true,
            voteCount: 2,
            canVote: true,
          }),
        );
        return options;
      },
      act: async (view) => {
        await view.findByText("Export history");
        press(/^vote$/i);
      },
      assert: async (view) => {
        await view.findByText("2 votes");
      },
    },
  });

  describe("behavior", () => {
    it("loads comments past 100 and preserves loaded pages when a new comment is submitted", async () => {
      const api = mockApi();
      const post = getPortalPostFixture.ok({
        id: "post_test_1",
        canComment: true,
      });
      const first = listPortalPostCommentsFixture.ok({
        items: Array.from({ length: 100 }, (_, index) =>
          listPortalPostCommentsFixture.comment({
            id: `comment_${index}`,
            content: `Earlier reply ${index}`,
          }),
        ),
        nextOffset: 100,
      });
      const last = listPortalPostCommentsFixture.comment({
        id: "comment_101",
        content: "Reply after the first hundred",
      });
      api.reply(post);
      api.reply(first);
      api.reply(findPortalSimilarPostsFixture.ok());
      api.reply(listPortalPostCommentsFixture.ok({ items: [last] }));
      const view = renderPage(PostPage, meta, {
        ...options,
        viewer: { kind: "user", id: "account_test_1" },
      });
      await view.findByText("Earlier reply 99");
      press("Load more comments");
      await view.findByText(last.content);
      expect(
        view.queryByRole("button", { name: "Load more comments" }),
      ).not.toBeInTheDocument();
      expect(
        new URL(
          api.calls("listQuillsPortalPostComments")[1]!.url,
        ).searchParams.get("offset"),
      ).toBe("100");
      const created = createPortalCommentFixture.ok({
        id: "comment_102",
        content: "New reply on the second page",
      });
      api.reply(created);
      api.reply(first);
      api.reply(listPortalPostCommentsFixture.ok({ items: [last, created] }));
      api.reply(post);
      fill("Comment", created.content);
      press("Post comment");
      await view.findByText(created.content);
      expect(view.getByText("Earlier reply 99")).toBeInTheDocument();
      expect(view.getByText(last.content)).toBeInTheDocument();
    });
    it("renders the post and updates the vote outcome", async () => {
      const api = mockApi();
      api.reply(
        getPortalPostFixture.ok({
          id: "post_test_1",
          title: "Export history",
          voted: false,
          voteCount: 1,
          canVote: true,
        }),
      );
      api.reply(listPortalPostCommentsFixture.ok());
      api.reply(findPortalSimilarPostsFixture.ok());
      api.reply(
        setPortalVoteFixture.ok({
          postId: "post_test_1",
          voted: true,
          voteCount: 2,
          changed: true,
        }),
      );
      api.reply(
        getPortalPostFixture.ok({
          id: "post_test_1",
          title: "Export history",
          voted: true,
          voteCount: 2,
          canVote: true,
        }),
      );
      const view = renderPage(PostPage, meta, {
        params: { postId: "post_test_1" },
      });

      await view.findByText("Export history");
      press(/^vote$/i);
      expect(await view.findByText("2 votes")).toBeInTheDocument();
      expect(api.calls("setQuillsPortalVote")).toHaveLength(1);
    });

    it("lists related requests without the post itself", async () => {
      const api = mockApi();
      api.reply(
        getPortalPostFixture.ok({ id: "post_test_1", title: "Export history" }),
      );
      api.reply(listPortalPostCommentsFixture.ok());
      api.reply(
        findPortalSimilarPostsFixture.ok({
          items: [
            {
              id: "post_test_1",
              title: "Export history",
              voteCount: 3,
              stage: null,
              board: { id: "board_test_1", slug: "ideas" },
            },
            {
              id: "post_test_2",
              title: "Export to CSV",
              voteCount: 5,
              stage: "planned",
              board: { id: "board_test_1", slug: "ideas" },
            },
          ],
        }),
      );
      const view = renderPage(PostPage, meta, options);
      expect(
        await view.findByRole("heading", { name: "Related requests" }),
      ).toBeInTheDocument();
      expect(view.getByRole("link", { name: /Export to CSV/ })).toHaveAttribute(
        "href",
        "/portal/workspace_test_1/posts/post_test_2",
      );
      expect(
        view.queryByRole("link", { name: /^3 votes Export history/ }),
      ).not.toBeInTheDocument();
    });

    it("does not fetch a record without portal access", async () => {
      const api = mockApi();
      const view = renderPage(PostPage, meta, {
        accessGranted: false,
        params: { postId: "post_test_1" },
      });
      expect(await view.findByRole("status")).toHaveTextContent(/sign in/i);
      expect(api.calls()).toHaveLength(0);
    });
  });
});
