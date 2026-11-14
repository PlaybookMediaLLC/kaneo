import type { RequestConversationSummaryResponse } from "./request-conversation-summary";
export const requestConversationSummaryFixture = {
  ok: (overrides: Partial<RequestConversationSummaryResponse> = {}) =>
    ({
      ...{ requested: true },
      ...overrides,
    }) satisfies RequestConversationSummaryResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
