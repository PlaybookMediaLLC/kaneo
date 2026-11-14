import type { SetSurveyStatusResponse } from "./set-survey-status";
export const setSurveyStatusFixture = {
  ok: (overrides: Partial<SetSurveyStatusResponse> = {}) =>
    ({
      ...{
        id: "id_test_1",
        type: "nps",
        question: "value",
        options: [],
        targetSegmentIds: null,
        status: "draft",
        responseCount: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      ...overrides,
    }) satisfies SetSurveyStatusResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
