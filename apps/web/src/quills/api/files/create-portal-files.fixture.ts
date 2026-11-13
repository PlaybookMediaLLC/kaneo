import type { CreatePortalFilesResponse } from "./create-portal-files";
export const createPortalFilesFixture = {
  ok: (overrides: Partial<CreatePortalFilesResponse> = {}) =>
    ({
      ...{
        id: "id_test_1",
        name: "value",
        contentType: "value",
        size: 0,
        family: "value",
        createdAt: "2026-01-01T00:00:00.000Z",
        created: false,
      },
      ...overrides,
    }) satisfies CreatePortalFilesResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
