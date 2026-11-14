import type { RestoreSuggestionResponse } from "./restore-suggestion";
export const restoreSuggestionFixture = {
  ok: (overrides: Partial<RestoreSuggestionResponse> = {}) =>
    ({
      ...{ id: "id_test_1", status: "pending" },
      ...overrides,
    }) satisfies RestoreSuggestionResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
