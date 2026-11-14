import type { RecordPublicArticleFeedbackResponse } from "./record-public-article-feedback";
export const recordPublicArticleFeedbackFixture = {
  ok: (overrides: Partial<RecordPublicArticleFeedbackResponse> = {}) =>
    ({
      ...{ feedbackId: "feedback_id_test_1", helpful: false, changed: false },
      ...overrides,
    }) satisfies RecordPublicArticleFeedbackResponse,
  problem: (status: 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
