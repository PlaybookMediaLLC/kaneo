import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { getBoardSettingsFixture } from "../../api/team/get-board-settings.fixture";
import { getRevenueAtRiskFixture } from "../../api/team/get-revenue-at-risk.fixture";
import type { ListBoardsResponse } from "../../api/team/list-boards";
import { listBoardsFixture } from "../../api/team/list-boards.fixture";
import { listPostsFixture } from "../../api/team/list-posts.fixture";
import { setPostScoreFixture } from "../../api/team/set-post-score.fixture";
import { updateBoardSettingsFixture } from "../../api/team/update-board-settings.fixture";
import { fill, press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { TeamTriagePage } from "./team-triage-page";

const board: ListBoardsResponse["items"][number] = {
  id: "board_test_1",
  name: "Ideas",
  slug: "ideas",
  description: null,
  access: {
    view: "anonymous",
    vote: "anonymous",
    comment: "anonymous",
    submit: "anonymous",
    segments: { view: [], vote: [], comment: [], submit: [] },
    moderation: {
      anonPosts: "inherit",
      signedPosts: "inherit",
      comments: "inherit",
    },
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const post = {
  ...setPostScoreFixture.ok({
    id: "post_test_1",
    title: "Export history",
    voteCount: 4,
  }),
  demand: {
    voters: 4,
    companies: 2,
    mrrCents: 150000,
    importance: { nice: 1, important: 1, critical: 2 },
  },
};
const prepare = () => {
  const api = mockApi();
  api.reply(listPostsFixture.ok({ items: [post] }));
  api.reply(getRevenueAtRiskFixture.ok({ companies: 2, mrrCents: 150000 }));
  api.reply(listBoardsFixture.ok({ items: [board] }));
  api.reply(getBoardSettingsFixture.ok({ boardId: board.id }));
  return api;
};

let api: ReturnType<typeof mockApi>;

describe("TeamTriagePage", () => {
  describePageContract(meta, TeamTriagePage, {
    loading: {
      prepare: () => {
        const api = mockApi();
        for (let i = 0; i < 3; i++) api.defer(() => undefined);
      },
    },
    failed: {
      prepare: () => {
        const api = mockApi();
        for (let i = 0; i < 3; i++) api.fail();
      },
    },
    ready: {
      prepare: () => {
        prepare();
      },
      assert: async (view) => {
        await view.findByText("Export history");
      },
    },
    done: {
      prepare: () => {
        api = prepare();
        api.reply(
          updateBoardSettingsFixture.ok({
            boardId: board.id,
            voteDisplay: "hidden",
          }),
        );
        api.reply(
          getBoardSettingsFixture.ok({
            boardId: board.id,
            voteDisplay: "hidden",
          }),
        );
      },
      act: async (view) => {
        await view.findByLabelText("Vote counts");
        fill("Vote counts", "hidden");
        press("Save voting settings");
      },
      assert: async () => {
        await waitFor(() =>
          expect(api.calls("updateQuillsBoardSettings")).toHaveLength(1),
        );
        expect(await api.calls("updateQuillsBoardSettings")[0]!.json()).toEqual(
          { voteDisplay: "hidden", defaultSort: "votes" },
        );
      },
    },
  });

  describe("behavior", () => {
    it("shows demand, revenue at risk and sorts by revenue", async () => {
      api = prepare();
      api.reply(listPostsFixture.ok({ items: [post] }));
      const view = renderPage(TeamTriagePage, meta);
      expect(
        await view.findByRole("rowheader", { name: "Export history" }),
      ).toBeVisible();
      expect(view.getByText(/1,500 MRR from 2 companies/)).toBeVisible();
      press("MRR");
      await waitFor(() => expect(api.calls("listQuillsPosts")).toHaveLength(2));
      expect(
        new URL(api.calls("listQuillsPosts")[1]!.url).searchParams.get("sort"),
      ).toBe("mrr");
    });

    it("saves a score from the inline editor", async () => {
      api = prepare();
      api.reply(
        setPostScoreFixture.ok({
          id: post.id,
          score: { reach: 100, impact: 2, confidence: 80, effort: 4, rice: 40 },
        }),
      );
      api.reply(listPostsFixture.ok({ items: [post] }));
      const view = renderPage(TeamTriagePage, meta);
      await view.findByRole("button", { name: /score .export history/i });
      press(/score .export history/i);
      fill("Reach", "100");
      fill("Confidence (%)", "80");
      fill("Effort (person-weeks)", "4");
      fill("Impact", "2");
      press("Save score");
      await waitFor(() =>
        expect(api.calls("setQuillsPostScore")).toHaveLength(1),
      );
      expect(await api.calls("setQuillsPostScore")[0]!.json()).toEqual({
        reach: 100,
        impact: 2,
        confidence: 80,
        effort: 4,
      });
    });

    it("hides the score editor and voting settings without the actions", async () => {
      prepare();
      const view = renderPage(TeamTriagePage, meta, {
        permissions: { update: false, manageSettings: false },
      });
      await view.findByRole("rowheader", { name: "Export history" });
      expect(
        view.queryByRole("button", { name: /score/i }),
      ).not.toBeInTheDocument();
      expect(view.queryByLabelText("Vote counts")).not.toBeInTheDocument();
    });
  });
});
