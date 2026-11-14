import type { DismissFeedbackSignalResponse } from "./dismiss-feedback-signal";
export const dismissFeedbackSignalFixture = {
  ok: (overrides: Partial<DismissFeedbackSignalResponse> = {}) =>
    ({
      ...{
        id: "feedback_signal_test_1",
        status: "dismissed",
        resultingPostId: null,
      },
      ...overrides,
    }) satisfies DismissFeedbackSignalResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
