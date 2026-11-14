import type { SuggestTicketFieldValuesResponse } from "./suggest-ticket-field-values";
export const suggestTicketFieldValuesFixture = {
  ok: (overrides: Partial<SuggestTicketFieldValuesResponse> = {}) =>
    ({
      ...{
        id: "id_test_1",
        kind: "copilot",
        status: "pending",
        output: null,
        error: null,
        createdAt: "value",
        finishedAt: null,
      },
      ...overrides,
    }) satisfies SuggestTicketFieldValuesResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
