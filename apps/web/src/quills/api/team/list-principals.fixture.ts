import type { ListPrincipalsResponse } from "./list-principals";
export const listPrincipalsFixture = {
  ok: (overrides: Partial<ListPrincipalsResponse> = {}) =>
    ({
      ...{ items: [], nextOffset: null },
      ...overrides,
    }) satisfies ListPrincipalsResponse,
  problem: (status: 401 | 403 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
