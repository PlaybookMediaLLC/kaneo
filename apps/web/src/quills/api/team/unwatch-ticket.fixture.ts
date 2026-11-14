import type { UnwatchTicketResponse } from "./unwatch-ticket";
export const unwatchTicketFixture = {
  ok: (overrides: Partial<UnwatchTicketResponse> = {}) =>
    ({
      ...{ watching: false, reason: "requester", mutedUntil: null },
      ...overrides,
    }) satisfies UnwatchTicketResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
