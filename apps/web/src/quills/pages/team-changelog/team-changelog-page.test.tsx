import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { draftChangelogFromPostsFixture } from "../../api/team/draft-changelog-from-posts.fixture";
import { listChangelogEngagementFixture } from "../../api/team/list-changelog-engagement.fixture";
import { searchShippedPostsFixture } from "../../api/team/search-shipped-posts.fixture";
import { press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { TeamChangelogPage } from "./team-changelog-page";

const engagement = listChangelogEngagementFixture.ok({
  items: [
    {
      id: "changelog_test_1",
      title: "November release",
      publishedAt: "2026-11-01T12:00:00.000Z",
      readCount: 4,
      reactions: [{ emoji: "🎉", count: 2 }],
    },
  ],
  nextOffset: 20,
});
const shipped = searchShippedPostsFixture.ok({
  posts: [
    {
      id: "post_test_1",
      title: "Dark mode",
      voteCount: 3,
      boardSlug: "ideas",
      authorName: null,
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  ],
});

describe("TeamChangelogPage", () => {
  describePageContract(meta, TeamChangelogPage, {
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
        api.reply(engagement);
        api.reply(shipped);
      },
      assert: async (view) => {
        expect(await view.findByText("November release")).toBeInTheDocument();
        expect(view.getByText("4 readers")).toBeInTheDocument();
        expect(
          view.getByRole("button", { name: "Load more updates" }),
        ).toBeInTheDocument();
      },
    },
    done: {
      prepare: () => {
        const api = mockApi();
        api.reply(engagement);
        api.reply(shipped);
        api.reply(
          draftChangelogFromPostsFixture.ok({
            title: "Dark mode is here",
            body: "- Dark mode",
            postIds: ["post_test_1"],
            requesterCount: 3,
          }),
        );
        api.reply(engagement);
      },
      act: async (view) => {
        await view.findByText("November release");
        press("Draft from shipped requests");
        (await screen.findByRole("checkbox", { name: /Dark mode/ })).click();
        const submit = screen.getByRole("button", { name: "Draft with AI" });
        await vi.waitFor(() => expect(submit).toBeEnabled());
        submit.click();
      },
      assert: async () => {
        expect(
          await screen.findByRole("region", { name: "Draft for review" }),
        ).toHaveTextContent("Dark mode is here");
      },
    },
  });

  describe("behavior", () => {
    it("sends the chosen post IDs and nothing else", async () => {
      const api = mockApi();
      api.reply(engagement);
      api.reply(shipped);
      api.reply(draftChangelogFromPostsFixture.ok());
      api.reply(engagement);
      const view = renderPage(TeamChangelogPage, meta);
      await view.findByText("November release");
      press("Draft from shipped requests");
      (await screen.findByRole("checkbox", { name: /Dark mode/ })).click();
      const submit = screen.getByRole("button", { name: "Draft with AI" });
      await vi.waitFor(() => expect(submit).toBeEnabled());
      submit.click();
      await vi.waitFor(() =>
        expect(api.calls("draftQuillsChangelogFromPosts")).toHaveLength(1),
      );
      expect(
        await api.calls("draftQuillsChangelogFromPosts")[0]!.clone().json(),
      ).toEqual({ postIds: ["post_test_1"] });
    });
  });
});
