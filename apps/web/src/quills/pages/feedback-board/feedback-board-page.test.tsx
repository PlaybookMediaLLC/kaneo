import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { getPortalUserStatsFixture } from "../../api/feedback/get-portal-user-stats.fixture";
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
    voteDisplay: "count" as const,
    defaultSort: null,
  };
  const prepareBoard = (signedIn = false) => {
    const api = mockApi();
    api.reply(listPortalBoardsFixture.ok({ items: [board] }));
    api.reply(listPortalStatusesFixture.ok());
    // A signed-in viewer also loads their activity.
    if (signedIn) api.reply(getPortalUserStatsFixture.ok());
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
        const api = prepareBoard(true);
        api.reply(createPortalPostFixture.ok());
        api.reply(listPortalPostsFixture.ok());
        api.reply(listPortalBoardsFixture.ok({ items: [board] }));
        api.reply(getPortalUserStatsFixture.ok());
        return {
          ...options,
          viewer: { kind: "user" as const, id: "account_test_1" },
        };
      },
      act: async (view) => {
        await view.findByLabelText("Title");
        fill("Title", "UX");
        press("Submit feedback");
        await view.findByText("Thanks! Your feedback was posted.");
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
    it("filters the board by status from the rail", async () => {
      const api = mockApi();
      api.reply(listPortalBoardsFixture.ok({ items: [board] }));
      api.reply(
        listPortalStatusesFixture.ok({
          items: [
            {
              id: "post_status_test_1",
              name: "Planned",
              slug: "planned",
              color: "blue",
              category: "active",
              showOnRoadmap: true,
              stage: "planned",
            },
          ],
        }),
      );
      api.reply(listPortalPostsFixture.ok());
      api.reply(listPortalPostsFixture.ok());
      const view = renderPage(FeedbackBoardPage, meta, options);
      await view.findByRole("button", { name: /Planned/ });
      press(/Planned/);
      expect(
        await view.findByRole("button", { name: /Planned/, pressed: true }),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(api.calls("listQuillsPortalPosts")).toHaveLength(2),
      );
      const filtered = new URL(api.calls("listQuillsPortalPosts")[1]!.url);
      expect(filtered.searchParams.get("stage")).toBe("planned");
      expect(filtered.searchParams.get("boardId")).toBe("board_test_1");
    });
    it("uses the board's default sort and hides counts the board hides", async () => {
      const api = mockApi();
      const { voteCount: _count, ...hidden } = getPortalPostFixture.ok({
        id: "post_test_1",
        title: "Export history",
      });
      api.reply(
        listPortalBoardsFixture.ok({
          items: [{ ...board, voteDisplay: "hidden", defaultSort: "random" }],
        }),
      );
      api.reply(listPortalStatusesFixture.ok());
      api.reply(listPortalPostsFixture.ok({ items: [hidden] }));
      const view = renderPage(FeedbackBoardPage, meta, options);
      await view.findByText(hidden.title);
      const listed = new URL(api.calls("listQuillsPortalPosts")[0]!.url);
      expect(listed.searchParams.get("sort")).toBe("random");
      expect(view.getByRole("combobox", { name: "Sort" })).toHaveTextContent(
        "Shuffled",
      );
      expect(view.getByRole("button", { name: "Vote" })).toBeVisible();
      expect(view.queryByText(/\d+ votes?/)).not.toBeInTheDocument();
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
