import type { RecordPortalAccessDeniedResponse } from "./record-portal-access-denied";
export const recordPortalAccessDeniedFixture = {
  ok: (overrides: Partial<RecordPortalAccessDeniedResponse> = {}) =>
    ({
      ...{ recorded: false, reason: "public" },
      ...overrides,
    }) satisfies RecordPortalAccessDeniedResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
