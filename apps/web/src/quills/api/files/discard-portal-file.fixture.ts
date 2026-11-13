import type { DiscardPortalFileResponse } from "./discard-portal-file";
export const discardPortalFileFixture = {
  ok: (overrides: Partial<DiscardPortalFileResponse> = {}) =>
    ({
      ...{ id: "id_test_1" },
      ...overrides,
    }) satisfies DiscardPortalFileResponse,
  problem: (status: 401 | 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
