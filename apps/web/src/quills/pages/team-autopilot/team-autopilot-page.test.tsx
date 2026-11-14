import { fireEvent } from "@testing-library/react";
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
import { renderComponent, renderPage } from "../../test/render";
import { ShortcutListener } from "../../ui/upstream";
import { meta } from "./meta";
import { signalsFixture } from "./signals.fixture";
import { TeamAutopilotPage } from "./team-autopilot-page";

const signal = signalsFixture.signal;
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
/** The two page queries: the given signals and one board. */
const queue = (items = [signal()]) => {
  const api = mockApi();
  api.reply(signalsFixture.list(items));
  api.reply(listBoardsFixture.ok({ items: [board] }));
  return api;
};
/** Renders the page and opens the signal with this title. */
const openSignal = async (title = "Dark theme", permissions = {}) => {
  const view = renderPage(TeamAutopilotPage, meta, { permissions });
  fireEvent.click(await view.findByRole("link", { name: new RegExp(title) }));
  await view.findByRole("heading", { level: 1, name: title });
  return view;
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
    it("groups the pending signals, opens one and adds the customer's vote", async () => {
      const api = queue([
        signal(),
        signal({
          id: "feedback_signal_test_2",
          suggestedTitle: "CSV export",
          matchedPost: null,
        }),
      ]);
      api.reply(acceptFeedbackSignalAsVoteFixture.ok());
      api.reply(
        signalsFixture.list([
          signal({
            id: "feedback_signal_test_2",
            suggestedTitle: "CSV export",
            matchedPost: null,
          }),
        ]),
      );
      const view = renderPage(TeamAutopilotPage, meta);
      expect(
        await view.findByRole("group", { name: "Matches a post 1" }),
      ).toHaveTextContent("Dark theme");
      expect(
        view.getByRole("group", { name: "New requests 1" }),
      ).toHaveTextContent("CSV export");
      const list = new URL(api.calls("listQuillsFeedbackSignals")[0]!.url);
      expect(list.searchParams.get("status")).toBe("pending");
      fireEvent.click(view.getByRole("link", { name: /Dark theme/ }));
      expect(
        await view.findByRole("heading", { level: 1, name: "Dark theme" }),
      ).toHaveFocus();
      expect(view.getByText("Conversation: Night use")).toBeInTheDocument();
      press("Add vote");
      expect(
        await view.findByText("Added the customer's vote to “Dark mode”."),
      ).toHaveAttribute("role", "status");
      const [vote] = api.calls("acceptQuillsFeedbackSignalAsVote");
      expect(new URL(vote!.url).pathname).toContain(
        "/feedback-signals/feedback_signal_test_1/vote",
      );
      expect(await vote!.clone().json()).toEqual({ postId: "post_test_1" });
      // The next signal opens, because the decided one left the list.
      expect(
        await view.findByRole("heading", { level: 1, name: "CSV export" }),
      ).toBeInTheDocument();
    });

    it("accepts a signal as a new post with a board and an edited title", async () => {
      const api = queue();
      api.reply(acceptFeedbackSignalAsPostFixture.ok());
      api.reply(listFeedbackSignalsFixture.ok());
      const view = await openSignal();
      press("Accept as new post");
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
      expect(
        await view.findByRole("heading", { level: 1, name: "Autopilot" }),
      ).toBeInTheDocument();
      expect(view.getByText("Nothing is here yet.")).toBeInTheDocument();
    });

    it("dismisses a pending signal and shows a failed decision", async () => {
      const api = queue();
      api.fail();
      api.reply(dismissFeedbackSignalFixture.ok());
      api.reply(listFeedbackSignalsFixture.ok());
      const view = await openSignal();
      press("Dismiss");
      expect(await view.findByRole("alert")).toBeInTheDocument();
      press("Dismiss");
      expect(
        await view.findByText("Dismissed: “Dark theme”."),
      ).toBeInTheDocument();
      expect(api.calls("dismissQuillsFeedbackSignal")).toHaveLength(2);
      expect(view.queryByRole("alert")).toBeNull();
    });

    it("lists the dismissed signals and restores one", async () => {
      const api = mockApi();
      api.reply(listFeedbackSignalsFixture.ok());
      api.reply(listBoardsFixture.ok({ items: [board] }));
      api.reply(signalsFixture.list([signal({ status: "dismissed" })]));
      api.reply(restoreFeedbackSignalFixture.ok());
      api.reply(listFeedbackSignalsFixture.ok());
      const view = renderPage(TeamAutopilotPage, meta);
      await view.findByText("Nothing is here yet.");
      press("Filters");
      fireEvent.click(
        await view.findByRole("menuitemradio", { name: "Dismissed" }),
      );
      expect(
        await view.findByRole("heading", {
          level: 1,
          name: "Dismissed signals",
        }),
      ).toBeInTheDocument();
      fireEvent.click(await view.findByRole("link", { name: /Dark theme/ }));
      const dismissed = new URL(api.calls("listQuillsFeedbackSignals")[1]!.url);
      expect(dismissed.searchParams.get("status")).toBe("dismissed");
      expect(view.queryByRole("button", { name: "Dismiss" })).toBeNull();
      press("Restore");
      expect(
        await view.findByText("Restored: “Dark theme”."),
      ).toBeInTheDocument();
      expect(api.calls("restoreQuillsFeedbackSignal")).toHaveLength(1);
    });

    it("moves through the list by key, opens a signal with Enter and goes back with Escape", async () => {
      queue([
        signal(),
        signal({ id: "feedback_signal_test_2", suggestedTitle: "CSV export" }),
      ]);
      renderComponent(<ShortcutListener />);
      const view = renderPage(TeamAutopilotPage, meta);
      await view.findByRole("link", { name: /CSV export/ });
      fireEvent.keyDown(document.body, { key: "j" });
      fireEvent.keyDown(document.body, { key: "j" });
      expect(view.getByRole("link", { name: /CSV export/ })).toHaveAttribute(
        "aria-current",
        "true",
      );
      fireEvent.keyDown(document.body, { key: "Enter" });
      expect(
        await view.findByRole("heading", { level: 1, name: "CSV export" }),
      ).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: "k" });
      expect(
        await view.findByRole("heading", { level: 1, name: "Dark theme" }),
      ).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(
        await view.findByRole("heading", { level: 1, name: "Autopilot" }),
      ).toHaveFocus();
    });

    it("hides the decisions from a teammate without create and update", async () => {
      queue();
      const view = await openSignal("Dark theme", {
        create: false,
        update: false,
      });
      expect(view.queryByRole("group", { name: "Signal actions" })).toBeNull();
    });
  });
});
