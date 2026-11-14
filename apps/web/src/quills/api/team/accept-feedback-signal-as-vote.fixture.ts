import type { AcceptFeedbackSignalAsVoteResponse } from "./accept-feedback-signal-as-vote";
export const acceptFeedbackSignalAsVoteFixture = {
  ok: (overrides: Partial<AcceptFeedbackSignalAsVoteResponse> = {}) =>
    ({
      ...{
        id: "feedback_signal_test_1",
        status: "accepted",
        resultingPostId: "post_test_1",
        voteAdded: true,
        voterPrincipalId: "principal_test_1",
      },
      ...overrides,
    }) satisfies AcceptFeedbackSignalAsVoteResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
