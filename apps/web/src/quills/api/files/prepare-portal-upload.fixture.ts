import type { PreparePortalUploadResponse } from "./prepare-portal-upload";
export const preparePortalUploadFixture = {
  ok: (overrides: Partial<PreparePortalUploadResponse> = {}) =>
    ({
      ...{ ready: false },
      ...overrides,
    }) satisfies PreparePortalUploadResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
