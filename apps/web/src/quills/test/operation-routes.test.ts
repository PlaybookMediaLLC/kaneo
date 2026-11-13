import { describe, expect, it } from "vite-plus/test";
import { quillsOperationRoutes } from "./operation-routes";

describe("quillsOperationRoutes", () => {
  it("keeps each OpenAPI operation addressable by a unique ID", () => {
    expect(
      new Set(quillsOperationRoutes.map((route) => route.operationId)).size,
    ).toBe(quillsOperationRoutes.length);
    expect(quillsOperationRoutes).toContainEqual({
      operationId: "getQuillsPublicPortalConfig",
      method: "GET",
      path: "/api/quills-public/{workspace}/portal/config",
    });
  });
});
