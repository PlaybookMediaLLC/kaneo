import type { ImprovePortalPostDraftResponse } from "./improve-portal-post-draft";
export const improvePortalPostDraftFixture = {
  ok: (overrides: Partial<ImprovePortalPostDraftResponse> = {}) =>
    ({
      ...{ title: "value", problem: "value", boardId: null },
      ...overrides,
    }) satisfies ImprovePortalPostDraftResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429 | 502) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
