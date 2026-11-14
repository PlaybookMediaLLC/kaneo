import type { ListPortalMyFeedbackResponse } from "./list-portal-my-feedback";
export const listPortalMyFeedbackFixture = {
  ok: (overrides: Partial<ListPortalMyFeedbackResponse> = {}) =>
    ({
      ...{ items: [], nextOffset: null },
      ...overrides,
    }) satisfies ListPortalMyFeedbackResponse,
  problem: (status: 401 | 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
