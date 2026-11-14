import { describe, expect, it } from "vite-plus/test";
import { getPostFilterCountsFixture } from "../../api/team/get-post-filter-counts.fixture";
import { listPostsFixture } from "../../api/team/list-posts.fixture";
import { setPostScoreFixture } from "../../api/team/set-post-score.fixture";
import { groupPosts, postRow, tabCounts } from "./post-list";

const status = (
  id: string,
  category: "active" | "complete" | "closed",
  position: number,
) => ({
  id,
  name: `Status ${id}`,
  slug: id,
  color: "gray",
  category,
  position,
  showOnRoadmap: false,
  isDefault: false,
  createdAt: "2026-01-01T00:00:00.000Z",
});
const post = (id: string, statusId: string | null) =>
  listPostsFixture.ok({
    items: [
      {
        ...setPostScoreFixture.ok({ id, statusId, title: `Post ${id}` }),
        demand: {
          voters: 0,
          companies: 0,
          mrrCents: 0,
          importance: { nice: 0, important: 0, critical: 0 },
        },
      },
    ],
  }).items[0]!;
const statuses = [status("b", "active", 2), status("a", "complete", 1)];

describe("groupPosts", () => {
  it("groups by status in status order and puts unknown statuses last", () => {
    const groups = groupPosts(
      [post("1", "b"), post("2", "a"), post("3", null), post("4", "gone")],
      statuses,
      "No status",
    );
    expect(
      groups.map((group) => [group.label, group.items.map((item) => item.id)]),
    ).toEqual([
      ["Status a", ["2"]],
      ["Status b", ["1"]],
      ["No status", ["3", "4"]],
    ]);
  });
});

describe("postRow", () => {
  it("shows the author or the anonymous label, then votes, board and tags", () => {
    const row = postRow(
      {
        ...post("1", "a"),
        tags: [{ id: "t1", name: "API", color: "gray" }],
      },
      "Ideas",
      { votes: "3 votes", anonymous: "Anonymous" },
    );
    expect(row.person).toEqual({ name: "Anonymous" });
    expect(row.chips.map((chip) => chip.label)).toEqual([
      "3 votes",
      "Ideas",
      "API",
    ]);
  });
});

describe("tabCounts", () => {
  it("sums the status counts per category and for All", () => {
    expect(
      tabCounts(
        statuses,
        getPostFilterCountsFixture.ok({
          statuses: [
            { id: "a", count: 2 },
            { id: "b", count: 5 },
            { id: "gone", count: 1 },
          ],
        }),
      ),
    ).toEqual({ active: 5, complete: 2, closed: 0, all: 8 });
  });
});
