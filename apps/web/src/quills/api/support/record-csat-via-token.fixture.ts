import type { RecordCsatViaTokenResponse } from "./record-csat-via-token";
export const recordCsatViaTokenFixture = {
  ok: (overrides: Partial<RecordCsatViaTokenResponse> = {}) =>
    ({
      recorded: true,
      conversationId: "conversation_test_1",
      rating: 5,
      changed: true,
      ...overrides,
    }) satisfies RecordCsatViaTokenResponse,
  problem: (status: 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
