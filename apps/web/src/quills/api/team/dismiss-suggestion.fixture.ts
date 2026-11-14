import type { DismissSuggestionResponse } from "./dismiss-suggestion";
export const dismissSuggestionFixture = {
  ok: (overrides: Partial<DismissSuggestionResponse> = {}) =>
    ({
      ...{ id: "id_test_1", status: "pending" },
      ...overrides,
    }) satisfies DismissSuggestionResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
