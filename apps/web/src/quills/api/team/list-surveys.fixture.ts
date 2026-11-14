import type { ListSurveysResponse } from "./list-surveys";
export const listSurveysFixture = {
  ok: (overrides: Partial<ListSurveysResponse> = {}) =>
    ({
      ...{ surveys: [], nextOffset: null },
      ...overrides,
    }) satisfies ListSurveysResponse,
  problem: (status: 401 | 403 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
