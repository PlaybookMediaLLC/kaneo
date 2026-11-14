import type { RestoreFeedbackSignalResponse } from "./restore-feedback-signal";
export const restoreFeedbackSignalFixture = {
  ok: (overrides: Partial<RestoreFeedbackSignalResponse> = {}) =>
    ({
      ...{
        id: "feedback_signal_test_1",
        status: "pending",
        resultingPostId: null,
      },
      ...overrides,
    }) satisfies RestoreFeedbackSignalResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
