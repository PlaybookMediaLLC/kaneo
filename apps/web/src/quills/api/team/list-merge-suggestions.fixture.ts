import type { ListMergeSuggestionsResponse } from "./list-merge-suggestions";
export const listMergeSuggestionsFixture = {
  ok: (overrides: Partial<ListMergeSuggestionsResponse> = {}) =>
    ({
      ...{ items: [], nextOffset: null },
      ...overrides,
    }) satisfies ListMergeSuggestionsResponse,
  problem: (status: 401 | 403 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
