import { describe, expect, it } from "vite-plus/test";
import { usePortalViewer } from "./use-portal-viewer";
describe("usePortalViewer", () => {
  it("exports the viewer hook", () => {
    expect(usePortalViewer).toBeTypeOf("function");
  });
});
