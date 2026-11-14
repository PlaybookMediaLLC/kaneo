import type { ListTeamsResponse } from "./list-teams";
export const listTeamsFixture = {
  ok: (overrides: Partial<ListTeamsResponse> = {}) =>
    ({
      ...{ teams: [], members: [] },
      ...overrides,
    }) satisfies ListTeamsResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
