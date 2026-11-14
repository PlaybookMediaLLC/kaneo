import type { AcceptFeedbackSignalAsPostResponse } from "./accept-feedback-signal-as-post";
export const acceptFeedbackSignalAsPostFixture = {
  ok: (overrides: Partial<AcceptFeedbackSignalAsPostResponse> = {}) =>
    ({
      ...{
        id: "feedback_signal_test_1",
        status: "accepted",
        resultingPostId: "post_test_1",
      },
      ...overrides,
    }) satisfies AcceptFeedbackSignalAsPostResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
