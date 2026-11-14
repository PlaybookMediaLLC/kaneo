import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { getFeedbackInsightsFixture } from "../../api/team/get-feedback-insights.fixture";
import { press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { TeamInsightsPage } from "./team-insights-page";

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

describe("TeamInsightsPage", () => {
  describePageContract(meta, TeamInsightsPage, {
    loading: {
      prepare: () => {
        const api = mockApi();
        api.defer(() => undefined);
      },
    },
    failed: {
      prepare: () => {
        const api = mockApi();
        api.fail();
      },
    },
    ready: {
      prepare: () => {
        const api = mockApi();
        api.reply(getFeedbackInsightsFixture.ok());
      },
    },
  });

  describe("behavior", () => {
    it("shows the topics, the sentiment, the weekly trend and the top posts", async () => {
      const api = mockApi();
      api.reply(
        getFeedbackInsightsFixture.ok({
          tags: [
            { id: "tag_test_1", name: "Billing", color: "", count: 3 },
            { id: "tag_test_2", name: "Exports", color: "", count: 1 },
          ],
          sentiment: { positive: 2, neutral: 1, negative: 1 },
          weeks: [{ week: "2026-11-09", posts: 4, votes: 6 }],
          topPosts: [
            {
              id: "post_test_1",
              title: "Dark mode",
              boardName: "Ideas",
              newVotes: 5,
            },
          ],
        }),
      );
      const view = renderPage(TeamInsightsPage, meta);
      expect(await view.findByLabelText("Billing")).toHaveAttribute(
        "value",
        "3",
      );
      expect(view.getByLabelText("Billing")).toHaveAttribute("max", "3");
      expect(view.getByLabelText("Negative")).toHaveAttribute("max", "4");
      expect(
        view.getByRole("row", { name: "2026-11-09 4 6" }),
      ).toBeInTheDocument();
      expect(view.getByRole("link", { name: /Dark mode/ })).toHaveAttribute(
        "href",
        "/feedback/workspace_test_1/posts/post_test_1",
      );
      expect(view.getByText("Ideas · +5 votes")).toBeInTheDocument();
      expect(
        view.getByText("2026-10-15 to 2026-11-13 (UTC)"),
      ).toBeInTheDocument();
    });

    it("asks for the last 30 days, then for the chosen range", async () => {
      const api = mockApi();
      api.reply(getFeedbackInsightsFixture.ok());
      api.reply(getFeedbackInsightsFixture.ok());
      const view = renderPage(TeamInsightsPage, meta);
      await view.findByText("No new post has a tag in this range.");
      press("Filters");
      expect(
        await view.findByRole("menuitemradio", { name: "Last 30 days" }),
      ).toHaveAttribute("aria-checked", "true");
      expect(view.getByRole("group", { name: "Range" })).toBeInTheDocument();
      fireEvent.click(
        view.getByRole("menuitemradio", { name: "Last 180 days" }),
      );
      await view.findByText("No new post has a tag in this range.");
      const [first, second] = api
        .calls("getQuillsFeedbackInsights")
        .map((request) => new URL(request.url).searchParams.get("from"));
      expect(first).toBe(daysAgo(29));
      expect(second).toBe(daysAgo(179));
      expect(view.getByText("No new post has a sentiment yet.")).toBeVisible();
      expect(view.getByText("No post got a vote in this range.")).toBeVisible();
    });
  });
});
