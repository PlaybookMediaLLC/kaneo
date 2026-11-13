import { describe, expect, it } from "vite-plus/test";
import { portalHref } from "./portal-href";

describe("portalHref", () => {
  it("encodes the workspace and search values", () => {
    expect(portalHref("space/name", "/posts/post_1", { q: "one two" })).toBe(
      "/portal/space%2Fname/posts/post_1?q=one+two",
    );
  });
});
