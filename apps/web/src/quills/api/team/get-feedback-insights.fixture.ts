import type { GetFeedbackInsightsResponse } from "./get-feedback-insights";
export const getFeedbackInsightsFixture = {
  ok: (overrides: Partial<GetFeedbackInsightsResponse> = {}) =>
    ({
      ...{
        from: "2026-10-15",
        to: "2026-11-13",
        tags: [],
        sentiment: { positive: 0, neutral: 0, negative: 0 },
        weeks: [],
        topPosts: [],
      },
      ...overrides,
    }) satisfies GetFeedbackInsightsResponse,
  problem: (status: 400 | 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
