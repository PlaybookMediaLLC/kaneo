import { describe, expect, it } from "vite-plus/test";
import { commentThread, visibleComments } from "./visible-comments";

const comment = (id: string, parentId: string | null, deleted = false) => ({
  id,
  parentId,
  deleted,
});

describe("visibleComments", () => {
  it("hides a deleted comment without replies", () => {
    expect(
      visibleComments([comment("a", null, true), comment("b", null)]).map(
        (item) => item.id,
      ),
    ).toEqual(["b"]);
  });
  it("keeps a deleted parent of a live reply", () => {
    expect(
      visibleComments([comment("a", null, true), comment("b", "a")]).map(
        (item) => item.id,
      ),
    ).toEqual(["a", "b"]);
  });
  it("hides a deleted thread whose replies are all deleted", () => {
    expect(
      visibleComments([
        comment("a", null, true),
        comment("b", "a", true),
        comment("c", "b", true),
      ]),
    ).toEqual([]);
  });
  it("keeps a deleted chain that leads to a live reply", () => {
    expect(
      visibleComments([
        comment("a", null, true),
        comment("b", "a", true),
        comment("c", "b"),
      ]).map((item) => item.id),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("commentThread", () => {
  it("adds new comments once and finds the top-level ones", () => {
    const loaded = [comment("a", null), comment("b", "a")];
    const created = [comment("b", "a"), comment("c", "x")];
    const thread = commentThread(loaded, created);
    expect(thread.comments.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(thread.top.map((item) => item.id)).toEqual(["a", "c"]);
  });
});
