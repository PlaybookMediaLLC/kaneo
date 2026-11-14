import { describe, expect, it } from "vite-plus/test";
import { acceptFeedbackSignalAsPostFixture } from "../../api/team/accept-feedback-signal-as-post.fixture";
import { acceptFeedbackSignalAsVoteFixture } from "../../api/team/accept-feedback-signal-as-vote.fixture";
import { dismissFeedbackSignalFixture } from "../../api/team/dismiss-feedback-signal.fixture";
import { listBoardsFixture } from "../../api/team/list-boards.fixture";
import { listFeedbackSignalsFixture } from "../../api/team/list-feedback-signals.fixture";
import { restoreFeedbackSignalFixture } from "../../api/team/restore-feedback-signal.fixture";
import { fill, press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { TeamAutopilotPage } from "./team-autopilot-page";

const signal = (status: "pending" | "dismissed" = "pending") => ({
  id: "feedback_signal_test_1",
  status,
  source: {
    type: "conversation" as const,
    id: "conversation_test_1",
    title: "Night use",
    number: null,
  },
  customer: { principalId: "principal_test_1", displayName: "Ada" },
  excerpt: "Please add a dark mode.",
  suggestedTitle: "Dark theme",
  matchedPost: {
    id: "post_test_1",
    title: "Dark mode",
    voteCount: 4,
    boardName: "Ideas",
    statusName: null,
  },
  resultingPost: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  decidedAt: null,
});
const tier = "authenticated" as const;
const board = {
  id: "board_test_1",
  name: "Ideas",
  slug: "ideas",
  description: null,
  access: {
    view: tier,
    vote: tier,
    comment: tier,
    submit: tier,
    segments: { view: [], vote: [], comment: [], submit: [] },
    moderation: {
      anonPosts: "inherit" as const,
      signedPosts: "inherit" as const,
      comments: "inherit" as const,
    },
  },
  visibleSegmentIds: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};
/** The two page queries: one pending signal and one board. */
const queue = (status?: "dismissed") => {
  const api = mockApi();
  api.reply(listFeedbackSignalsFixture.ok({ items: [signal(status)] }));
  api.reply(listBoardsFixture.ok({ items: [board] }));
  return api;
};

describe("TeamAutopilotPage", () => {
  describePageContract(meta, TeamAutopilotPage, {
    loading: {
      prepare: () => {
        const api = mockApi();
        api.defer(() => undefined);
        api.defer(() => undefined);
      },
    },
    failed: {
      prepare: () => {
        const api = mockApi();
        api.fail();
        api.fail();
      },
    },
    ready: {
      prepare: () => {
        const api = mockApi();
        api.reply(listFeedbackSignalsFixture.ok());
        api.reply(listBoardsFixture.ok());
      },
    },
    done: {
      prepare: () => {
        const api = mockApi();
        api.reply(listFeedbackSignalsFixture.ok());
        api.reply(listBoardsFixture.ok());
      },
    },
  });

  describe("behavior", () => {
    it("lists pending signals and adds the customer's vote to the matched post", async () => {
      const api = queue();
      api.reply(acceptFeedbackSignalAsVoteFixture.ok());
      api.reply(listFeedbackSignalsFixture.ok());
      const view = renderPage(TeamAutopilotPage, meta);
      expect(await view.findByText("Dark theme")).toBeInTheDocument();
      expect(view.getByText("Conversation: Night use")).toBeInTheDocument();
      const list = new URL(api.calls("listQuillsFeedbackSignals")[0]!.url);
      expect(list.searchParams.get("status")).toBe("pending");
      press("Add the customer's vote to “Dark mode”");
      expect(
        await view.findByText("Added the customer's vote to “Dark mode”."),
      ).toHaveAttribute("role", "status");
      const [vote] = api.calls("acceptQuillsFeedbackSignalAsVote");
      expect(new URL(vote!.url).pathname).toContain(
        "/feedback-signals/feedback_signal_test_1/vote",
      );
      expect(await vote!.clone().json()).toEqual({ postId: "post_test_1" });
      expect(await view.findByText("Nothing is here yet.")).toBeInTheDocument();
    });

    it("accepts a signal as a new post with a board and an edited title", async () => {
      const api = queue();
      api.reply(acceptFeedbackSignalAsPostFixture.ok());
      api.reply(listFeedbackSignalsFixture.ok());
      const view = renderPage(TeamAutopilotPage, meta);
      await view.findByText("Dark theme");
      press("Accept as a new post: “Dark theme”");
      expect(await view.findByLabelText("Post title")).toHaveValue(
        "Dark theme",
      );
      fill("Post title", "Night theme");
      press("Create post");
      expect(
        await view.findByText("Added “Night theme” as a new post."),
      ).toBeInTheDocument();
      const [accept] = api.calls("acceptQuillsFeedbackSignalAsPost");
      expect(await accept!.clone().json()).toEqual({
        boardId: "board_test_1",
        title: "Night theme",
      });
      expect(view.queryByLabelText("Post title")).toBeNull();
    });

    it("dismisses a pending signal", async () => {
      const api = queue();
      api.reply(dismissFeedbackSignalFixture.ok());
      api.reply(listFeedbackSignalsFixture.ok());
      const view = renderPage(TeamAutopilotPage, meta);
      await view.findByText("Dark theme");
      press("Dismiss: “Dark theme”");
      expect(
        await view.findByText("Dismissed: “Dark theme”."),
      ).toBeInTheDocument();
      expect(api.calls("dismissQuillsFeedbackSignal")).toHaveLength(1);
    });

    it("lists the dismissed signals and restores one", async () => {
      const api = mockApi();
      api.reply(listFeedbackSignalsFixture.ok());
      api.reply(listBoardsFixture.ok({ items: [board] }));
      api.reply(
        listFeedbackSignalsFixture.ok({ items: [signal("dismissed")] }),
      );
      api.reply(restoreFeedbackSignalFixture.ok());
      api.reply(listFeedbackSignalsFixture.ok());
      const view = renderPage(TeamAutopilotPage, meta);
      await view.findByText("Nothing is here yet.");
      press("Dismissed");
      expect(view.getByRole("button", { name: "Dismissed" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await view.findByText("Dark theme");
      const dismissed = new URL(api.calls("listQuillsFeedbackSignals")[1]!.url);
      expect(dismissed.searchParams.get("status")).toBe("dismissed");
      expect(view.queryByRole("button", { name: /^Dismiss:/ })).toBeNull();
      press("Restore: “Dark theme”");
      expect(
        await view.findByText("Restored: “Dark theme”."),
      ).toBeInTheDocument();
      expect(api.calls("restoreQuillsFeedbackSignal")).toHaveLength(1);
    });

    it("hides the decisions from a teammate without create and update", async () => {
      queue();
      const view = renderPage(TeamAutopilotPage, meta, {
        permissions: { create: false, update: false },
      });
      await view.findByText("Dark theme");
      expect(view.queryByRole("button", { name: /^Accept as/ })).toBeNull();
      expect(view.queryByRole("button", { name: /vote/ })).toBeNull();
      expect(view.queryByRole("button", { name: /^Dismiss:/ })).toBeNull();
    });
  });
});
