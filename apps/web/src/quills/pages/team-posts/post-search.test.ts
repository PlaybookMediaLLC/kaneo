import { describe, expect, it } from "vite-plus/test";
import { listStatusesFixture } from "../../api/team/list-statuses.fixture";
import { filterPatch, postListInput, postSearch } from "./post-search";

const status = (id: string, category: "active" | "complete" | "closed") => ({
  id,
  name: id,
  slug: id,
  color: "gray",
  category,
  position: 0,
  showOnRoadmap: false,
  isDefault: false,
  createdAt: "2026-01-01T00:00:00.000Z",
});
const statuses = listStatusesFixture.ok({
  statuses: [
    status("open", "active"),
    status("planned", "active"),
    status("done", "complete"),
  ],
}).statuses;

describe("postSearch", () => {
  it("keeps valid filters and drops unknown values", () => {
    expect(postSearch.parse({})).toEqual({});
    expect(
      postSearch.parse({ status: "done", sort: "votes", board: "b1", q: "x" }),
    ).toEqual({ sort: "votes", board: "b1", q: "x" });
  });
});

describe("postListInput", () => {
  it("waits for the statuses", () => {
    const { input, none } = postListInput("ws", {}, undefined);
    expect(input.param.workspaceId).toBe("");
    expect(none).toBe(false);
  });

  it("filters the open tab by its statuses, the board and the search", () => {
    const { input } = postListInput(
      "ws",
      { board: "b1", q: "export", sort: "rice" },
      statuses,
    );
    expect(input).toEqual({
      param: { workspaceId: "ws" },
      query: {
        sort: "rice",
        limit: "50",
        statusIds: "open,planned",
        boardIds: "b1",
        search: "export",
      },
    });
  });

  it("filters one status that the sidebar opens", () => {
    const { input, none } = postListInput(
      "ws",
      { status: "complete", statusId: "planned" },
      statuses,
    );
    expect(none).toBe(false);
    expect(input.query.statusIds).toBe("planned");
  });

  it("sends no status filter for All", () => {
    const { input } = postListInput("ws", { status: "all" }, statuses);
    expect(input.query).toEqual({ sort: "newest", limit: "50" });
  });

  it("asks for nothing when the tab has no status", () => {
    const { input, none } = postListInput("ws", { status: "closed" }, statuses);
    expect(none).toBe(true);
    expect(input.param.workspaceId).toBe("");
  });
});

describe("filterPatch", () => {
  it("turns a filter menu choice into an address change", () => {
    expect(filterPatch("status", "closed")).toEqual({
      status: "closed",
      statusId: undefined,
    });
    expect(filterPatch("board", "")).toEqual({ board: undefined });
    expect(filterPatch("board", "board_ideas")).toEqual({
      board: "board_ideas",
    });
    expect(filterPatch("sort", "rice")).toEqual({ sort: "rice" });
    // A value that the address does not accept removes the key.
    expect(filterPatch("sort", "loudest")).toEqual({ sort: undefined });
  });
});
