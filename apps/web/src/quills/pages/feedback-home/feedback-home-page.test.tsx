import { describe, expect, it } from "vite-plus/test";
import { getPortalUserStatsFixture } from "../../api/feedback/get-portal-user-stats.fixture";
import { createPortalPostFixture } from "../../api/feedback/create-portal-post.fixture";
import { listPortalBoardsFixture } from "../../api/feedback/list-portal-boards.fixture";
import { listPortalPostsFixture } from "../../api/feedback/list-portal-posts.fixture";
import { listPortalStatusesFixture } from "../../api/feedback/list-portal-statuses.fixture";
import { fill, press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { FeedbackHomePage } from "./feedback-home-page";
describe("FeedbackHomePage", () => {
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
  const prepareHome = (signedIn = false) => {
    const api = mockApi();
    api.reply(listPortalBoardsFixture.ok({ items: [board] }));
    api.reply(listPortalStatusesFixture.ok());
    // A signed-in viewer also loads their activity.
    if (signedIn) api.reply(getPortalUserStatsFixture.ok());
    api.reply(listPortalPostsFixture.ok());
    return api;
  };
  describePageContract(meta, FeedbackHomePage, {
    loading: { prepare: () => void mockApi().defer(() => undefined) },
    failed: { prepare: () => void mockApi().fail() },
    ready: {
      prepare: () => void prepareHome(),
      assert: async (view) => {
        await view.findByRole("link", { name: /Ideas/ });
      },
    },
    done: {
      prepare: () => {
        const api = prepareHome(true);
        api.reply(createPortalPostFixture.ok());
        api.reply(listPortalPostsFixture.ok());
        api.reply(listPortalBoardsFixture.ok());
        api.reply(getPortalUserStatsFixture.ok());
        return { viewer: { kind: "user", id: "account_test_1" } };
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
    it("does not fetch feedback without portal access", async () => {
      const api = mockApi();
      const view = renderPage(FeedbackHomePage, meta, { accessGranted: false });
      expect(await view.findByRole("status")).toHaveTextContent(/sign in/i);
      expect(api.calls()).toHaveLength(0);
    });
  });
});
