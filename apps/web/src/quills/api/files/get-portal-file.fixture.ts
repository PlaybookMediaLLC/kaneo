import type { GetPortalFileResponse } from "./get-portal-file";
export const getPortalFileFixture = {
  ok: (overrides: Partial<GetPortalFileResponse> = {}) =>
    ({
      ...{
        id: "id_test_1",
        name: "value",
        contentType: "value",
        size: 0,
        downloadUrl: "value",
        downloadExpiresAt: "2026-01-01T00:00:00.000Z",
      },
      ...overrides,
    }) satisfies GetPortalFileResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
