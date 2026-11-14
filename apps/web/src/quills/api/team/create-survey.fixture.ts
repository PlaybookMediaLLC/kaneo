import type { CreateSurveyResponse } from "./create-survey";
export const createSurveyFixture = {
  ok: (overrides: Partial<CreateSurveyResponse> = {}) =>
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
    }) satisfies CreateSurveyResponse,
  problem: (status: 400 | 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
