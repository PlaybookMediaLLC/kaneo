import type { MarkNotificationReadResponse } from "./mark-notification-read";
export const markNotificationReadFixture = {
  ok: (overrides: Partial<MarkNotificationReadResponse> = {}) =>
    ({
      ...{ changed: false },
      ...overrides,
    }) satisfies MarkNotificationReadResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
