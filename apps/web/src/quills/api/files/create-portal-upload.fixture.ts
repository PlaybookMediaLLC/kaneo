import type { CreatePortalUploadResponse } from "./create-portal-upload";
export const createPortalUploadFixture = {
  ok: (overrides: Partial<CreatePortalUploadResponse> = {}) =>
    ({
      ...{
        key: "value",
        uploadUrl: "value",
        headers: { "Content-Type": "value" },
        expiresAt: "value",
      },
      ...overrides,
    }) satisfies CreatePortalUploadResponse,
  problem: (status: 400 | 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
