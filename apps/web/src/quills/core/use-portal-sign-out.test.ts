import { describe, expect, it } from "vite-plus/test";
import { usePortalSignOut } from "./use-portal-sign-out";
describe("usePortalSignOut", () => {
  it("exports the portal sign-out hook", () => {
    expect(usePortalSignOut).toBeTypeOf("function");
  });
});
