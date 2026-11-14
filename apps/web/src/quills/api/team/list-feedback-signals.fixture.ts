import type { ListFeedbackSignalsResponse } from "./list-feedback-signals";
export const listFeedbackSignalsFixture = {
  ok: (overrides: Partial<ListFeedbackSignalsResponse> = {}) =>
    ({
      ...{ items: [], nextOffset: null },
      ...overrides,
    }) satisfies ListFeedbackSignalsResponse,
  problem: (status: 401 | 403 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
