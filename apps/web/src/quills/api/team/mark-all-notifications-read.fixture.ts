import type { MarkAllNotificationsReadResponse } from "./mark-all-notifications-read";
export const markAllNotificationsReadFixture = {
  ok: (overrides: Partial<MarkAllNotificationsReadResponse> = {}) =>
    ({
      ...{ count: 0 },
      ...overrides,
    }) satisfies MarkAllNotificationsReadResponse,
  problem: (status: 401 | 403 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
