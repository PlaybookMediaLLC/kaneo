import type { GetPortalActiveSurveyResponse } from "./get-portal-active-survey";
export const getPortalActiveSurveyFixture = {
  ok: (overrides: Partial<GetPortalActiveSurveyResponse> = {}) =>
    ({
      ...{ survey: null },
      ...overrides,
    }) satisfies GetPortalActiveSurveyResponse,
  problem: (status: 401 | 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
