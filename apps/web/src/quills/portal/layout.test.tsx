import { describe, expect, it } from "vite-plus/test";
import { PortalLayout, PortalRoute } from "./layout";
describe("PortalLayout", () => {
  it("exports the shell and route component", () => {
    expect(PortalLayout).toBeTypeOf("function");
    expect(PortalRoute).toBeTypeOf("function");
  });
});
