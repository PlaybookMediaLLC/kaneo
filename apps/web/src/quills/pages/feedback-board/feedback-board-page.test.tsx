import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { createPortalPostFixture } from "../../api/feedback/create-portal-post.fixture";
import { listPortalBoardsFixture } from "../../api/feedback/list-portal-boards.fixture";
import { listPortalPostsFixture } from "../../api/feedback/list-portal-posts.fixture";
import { listPortalStatusesFixture } from "../../api/feedback/list-portal-statuses.fixture";
import { getPortalPostFixture } from "../../api/feedback/get-portal-post.fixture";
import { setPortalVoteFixture } from "../../api/feedback/set-portal-vote.fixture";
import { fill, press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { FeedbackBoardPage } from "./feedback-board-page";
describe("FeedbackBoardPage", () => {
  const options = { params: { boardId: "board_test_1" } };
  const board = {
    id: "board_test_1",
    name: "Ideas",
    slug: "ideas",
    description: null,
    postCount: 0,
    canSubmit: true,
    canVote: true,
    canComment: true,
  };
  const prepareBoard = () => {
    const api = mockApi();
    api.reply(listPortalBoardsFixture.ok({ items: [board] }));
    api.reply(listPortalStatusesFixture.ok());
    api.reply(listPortalPostsFixture.ok());
    return api;
  };
  describePageContract(meta, FeedbackBoardPage, {
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
        prepareBoard();
        return options;
      },
      assert: async (view) => {
        await view.findByRole("heading", { name: "Ideas" });
      },
    },
    done: {
      prepare: () => {
        const api = prepareBoard();
        api.reply(createPortalPostFixture.ok());
        api.reply(listPortalPostsFixture.ok());
        api.reply(listPortalBoardsFixture.ok({ items: [board] }));
        return {
          ...options,
          viewer: { kind: "user" as const, id: "account_test_1" },
        };
      },
      act: async (view) => {
        (await view.findByRole("button", { name: "Submit feedback" })).click();
        await view.findByLabelText("Details");
        fill("Details", "Please add exports");
        view
          .getAllByRole("button", { name: "Submit feedback" })
          .at(-1)
          ?.click();
        await waitFor(() =>
          expect(view.queryByLabelText("Details")).not.toBeInTheDocument(),
        );
      },
    },
  });
  describe("behavior", () => {
    it("refreshes the board vote and allows removing it without reloading", async () => {
      const api = mockApi();
      const post = getPortalPostFixture.ok({
        id: "post_test_1",
        title: "Export history",
        voted: false,
        voteCount: 0,
      });
      api.reply(listPortalBoardsFixture.ok({ items: [board] }));
      api.reply(listPortalStatusesFixture.ok());
      api.reply(listPortalPostsFixture.ok({ items: [post] }));
      api.reply(
        setPortalVoteFixture.ok({ postId: post.id, voted: true, voteCount: 1 }),
      );
      api.reply(
        listPortalPostsFixture.ok({
          items: [{ ...post, voted: true, voteCount: 1 }],
        }),
      );
      api.reply(
        setPortalVoteFixture.ok({
          postId: post.id,
          voted: false,
          voteCount: 0,
        }),
      );
      api.reply(listPortalPostsFixture.ok({ items: [post] }));
      const view = renderPage(FeedbackBoardPage, meta, options);
      await view.findByText(post.title);
      press("Vote");
      await view.findByRole("button", { name: "Remove vote" });
      press("Remove vote");
      await view.findByRole("button", { name: "Vote" });
      const requests = api.calls("setQuillsPortalVote");
      expect(await requests[0]!.json()).toEqual({ voted: true });
      expect(await requests[1]!.json()).toEqual({ voted: false });
    });
    it("does not fetch a board without portal access", async () => {
      const api = mockApi();
      const view = renderPage(FeedbackBoardPage, meta, {
        accessGranted: false,
        params: { boardId: "board_test_1" },
      });
      expect(await view.findByRole("status")).toHaveTextContent(/sign in/i);
      expect(api.calls()).toHaveLength(0);
    });
  });
});
