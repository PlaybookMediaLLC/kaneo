import type { UnmuteTicketResponse } from "./unmute-ticket";
export const unmuteTicketFixture = {
  ok: (overrides: Partial<UnmuteTicketResponse> = {}) =>
    ({
      ...{ watching: false, reason: "requester", mutedUntil: null },
      ...overrides,
    }) satisfies UnmuteTicketResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
