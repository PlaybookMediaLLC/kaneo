import { describe, expect, it } from "vite-plus/test";
import { portalReturnPath } from "./portal-return-path";
describe("portalReturnPath", () => {
  it("preserves the current search and ordinary anchor", () => {
    expect(portalReturnPath("/portal/workspace/hc?query=exports#results")).toBe(
      "/portal/workspace/hc?query=exports#results",
    );
  });
  it("does not copy mail credentials into the sign-in return URL", () => {
    expect(
      portalReturnPath(
        "/portal/workspace/invite/id?token=secret&view=details#token=secret",
      ),
    ).toBe("/portal/workspace/invite/id?view=details");
  });
});
