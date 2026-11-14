import { describe, expect, it, vi } from "vite-plus/test";
import { fetchAdminOverviewFixture } from "../../api/team/fetch-admin-overview.fixture";
import { listBoardsFixture } from "../../api/team/list-boards.fixture";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { handleUnauthorized } from "../../ui/upstream";
import { meta } from "./meta";
import { TeamHomePage } from "./team-home-page";

vi.mock("@/lib/http-error", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  handleUnauthorized: vi.fn(),
}));

const post = {
  boardName: "Ideas",
  statusName: "Open",
  at: "2026-11-01T00:00:00.000Z",
  mine: false,
};
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
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  postCount: 3,
};

describe("TeamHomePage", () => {
  describePageContract(meta, TeamHomePage, {
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
        api.reply(fetchAdminOverviewFixture.ok());
        api.reply(listBoardsFixture.ok());
      },
    },
  });

  describe("behavior", () => {
    it("shows what waits for the team and links each board to its portal page", async () => {
      const api = mockApi();
      api.reply(
        fetchAdminOverviewFixture.ok({
          feedback: {
            reviewCount: 12,
            completeCount: 1,
            review: [{ ...post, id: "post_test_1", title: "Dark mode" }],
            announce: [{ ...post, id: "post_test_2", title: "CSV export" }],
          },
          momentum: [
            { postId: "post_test_3", title: "Slack alerts", votesLast7d: 5 },
          ],
        }),
      );
      api.reply(listBoardsFixture.ok({ items: [board] }));
      const view = renderPage(TeamHomePage, meta);
      expect(
        await view.findByRole("heading", { name: "12 new ideas to review" }),
      ).toBeInTheDocument();
      expect(view.getByText("Dark mode")).toBeInTheDocument();
      expect(
        view.getByRole("heading", {
          name: "1 shipped idea is not in the changelog",
        }),
      ).toBeInTheDocument();
      expect(view.getByText("CSV export")).toBeInTheDocument();
      expect(view.getByText("5 votes")).toBeInTheDocument();
      expect(view.getByRole("link", { name: "Ideas" })).toHaveAttribute(
        "href",
        "/portal/workspace_test_1/boards/board_test_1",
      );
      expect(view.getByText("3 posts")).toBeInTheDocument();
      const boards = new URL(api.calls("listQuillsBoards")[0].url);
      expect(boards.searchParams.get("counts")).toBe("true");
    });

    it("starts the sign-in redirect when the session ends", async () => {
      const api = mockApi();
      api.reply({ message: "Unauthorized" }, 401);
      api.reply({ message: "Unauthorized" }, 401);
      const view = renderPage(TeamHomePage, meta);
      await vi.waitFor(() => expect(handleUnauthorized).toHaveBeenCalled());
      expect(view.queryByRole("link")).not.toBeInTheDocument();
    });

    it("says when nothing waits", async () => {
      const api = mockApi();
      api.reply(fetchAdminOverviewFixture.ok());
      api.reply(listBoardsFixture.ok());
      const view = renderPage(TeamHomePage, meta);
      expect(
        await view.findByRole("heading", { name: "0 new ideas to review" }),
      ).toBeInTheDocument();
      expect(view.getAllByText("Nothing waits here.")).toHaveLength(4);
    });
  });
});
