import { fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { getPostFilterCountsFixture } from "../../api/team/get-post-filter-counts.fixture";
import type { ListPostsResponse } from "../../api/team/list-posts";
import { listPostsFixture } from "../../api/team/list-posts.fixture";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { inboxBoards, inboxPosts, inboxStatuses } from "./inbox.fixture";
import { meta } from "./meta";
import { TeamPostsPage } from "./team-posts-page";

const counts = getPostFilterCountsFixture.ok({
  statuses: [
    { id: "status_open", count: 1 },
    { id: "status_planned", count: 1 },
    { id: "status_done", count: 4 },
  ],
});
// The statuses, boards and counts load first; the posts wait for the statuses.
const prepare = (posts: ListPostsResponse = inboxPosts) => {
  const api = mockApi();
  api.reply(inboxStatuses);
  api.reply(inboxBoards);
  api.reply(counts);
  api.reply(posts);
  return api;
};

describe("TeamPostsPage", () => {
  describePageContract(meta, TeamPostsPage, {
    loading: {
      prepare: () => {
        const api = mockApi();
        for (let index = 0; index < 3; index++) api.defer(() => undefined);
      },
    },
    failed: {
      prepare: () => {
        const api = mockApi();
        api.fail();
        api.reply(inboxBoards);
        api.reply(counts);
      },
    },
    empty: { prepare: () => void prepare(listPostsFixture.ok()) },
    ready: { prepare: () => void prepare() },
  });

  it("groups the open posts by status with tab counts and post details", async () => {
    const api = prepare();
    const view = renderPage(TeamPostsPage, meta);
    const list = await view.findByRole("region", { name: "Posts" });
    const open = within(list).getByRole("group", { name: /^Open/ });
    expect(open).toHaveTextContent("Export to CSV");
    expect(open).toHaveTextContent("3 votes");
    expect(open).toHaveTextContent("Ideas");
    expect(within(list).getByRole("group", { name: /^Planned/ })).toBeVisible();
    expect(view.getByRole("tab", { name: "Open 2" })).toBeVisible();
    expect(view.getByRole("tab", { name: "All 6" })).toBeVisible();
    const query = new URL(api.calls("listQuillsPosts")[0]!.url).searchParams;
    expect(query.get("statusIds")).toBe("status_open,status_planned");
    expect(query.get("sort")).toBe("newest");
  });

  it("keeps the filters in the address and opens a post with them", async () => {
    prepare();
    const view = renderPage(TeamPostsPage, meta, {
      search: { board: "board_ideas", sort: "votes" },
    });
    const row = await view.findByRole("link", { name: /Export to CSV/ });
    expect(row.getAttribute("href")).toContain(
      "/feedback/workspace_test_1/posts/post_export?",
    );
    fireEvent.click(row);
    await waitFor(() =>
      expect(view.router.state.location.pathname).toBe(
        "/feedback/workspace_test_1/posts/post_export",
      ),
    );
    expect(view.router.state.location.search).toEqual({
      board: "board_ideas",
      sort: "votes",
    });
  });

  it("changes the status tab in the address", async () => {
    prepare();
    const view = renderPage(TeamPostsPage, meta);
    await view.findByRole("region", { name: "Posts" });
    fireEvent.click(view.getByRole("tab", { name: /^Complete/ }));
    await waitFor(() =>
      expect(view.router.state.location.search).toEqual({
        status: "complete",
      }),
    );
  });
});
