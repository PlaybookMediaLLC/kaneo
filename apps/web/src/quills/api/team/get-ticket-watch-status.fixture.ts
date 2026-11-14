import type { GetTicketWatchStatusResponse } from "./get-ticket-watch-status";
export const getTicketWatchStatusFixture = {
  ok: (overrides: Partial<GetTicketWatchStatusResponse> = {}) =>
    ({
      ...{ watching: false, reason: "requester", mutedUntil: null },
      ...overrides,
    }) satisfies GetTicketWatchStatusResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
