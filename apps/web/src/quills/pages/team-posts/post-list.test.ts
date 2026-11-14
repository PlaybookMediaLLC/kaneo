import { describe, expect, it } from "vite-plus/test";
import { listPostsFixture } from "../../api/team/list-posts.fixture";
import { setPostScoreFixture } from "../../api/team/set-post-score.fixture";
import { groupPosts, postRow, staleMonths, statusIcon } from "./post-list";

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

const context = {
  statuses,
  boardName: new Map([["board_id_test_1", "Ideas"]]),
  anonymous: "Anonymous",
  stale: (months: number) => `Stale ${months}mo`,
};
const now = Date.parse("2026-01-01T00:00:00.000Z");
const month = 30 * 86_400_000;

describe("postRow", () => {
  it("shows the plain-text title, the counts, the board and the author or the anonymous label", () => {
    const row = postRow(
      {
        ...post("1", "a"),
        title: "**Bold** `export`",
        boardId: "board_id_test_1",
      },
      context,
      now,
    );
    expect(row).toMatchObject({
      title: "Bold export",
      board: "Ideas",
      person: { name: "Anonymous" },
      badges: [],
    });
    expect(typeof row.votes).toBe("number");
    expect(
      postRow({ ...post("2", "a"), boardId: "gone" }, context, now).board,
    ).toBeNull();
  });

  it("adds the red stale badge to an open post without change for six months", () => {
    const old = {
      ...post("1", "b"),
      updatedAt: new Date(now - 7 * month).toISOString(),
    };
    expect(postRow(old, context, now).badges).toEqual([
      { id: "stale", label: "Stale 7mo", tone: "error" },
    ]);
  });
});

describe("staleMonths", () => {
  it("counts only an open post that has not changed for six months or more", () => {
    const at = (months: number) => new Date(now - months * month).toISOString();
    expect(
      staleMonths({ statusId: "b", updatedAt: at(6) }, statuses, now),
    ).toBe(6);
    expect(
      staleMonths({ statusId: "b", updatedAt: at(5.9) }, statuses, now),
    ).toBe(0);
    // A complete or unknown status is never stale.
    expect(
      staleMonths({ statusId: "a", updatedAt: at(12) }, statuses, now),
    ).toBe(0);
    expect(
      staleMonths({ statusId: null, updatedAt: at(12) }, statuses, now),
    ).toBe(0);
  });
});

describe("statusIcon", () => {
  it("takes the status color and fills a later status more", () => {
    const open = [status("o", "active", 0), status("p", "active", 1)];
    expect(statusIcon(post("1", "p"), open)).toEqual({
      color: "gray",
      progress: 0.5,
    });
    expect(statusIcon(post("2", "gone"), open)).toEqual({
      color: null,
      progress: 0,
    });
  });
});
