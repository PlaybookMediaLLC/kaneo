import type { CreateConversationViewResponse } from "./create-conversation-view";
export const createConversationViewFixture = {
  ok: (overrides: Partial<CreateConversationViewResponse> = {}) =>
    ({
      ...{
        id: "id_test_1",
        name: "value",
        filters: { rules: [] },
        sort: "recent",
        isShared: false,
        isPinned: false,
        createdByPrincipalId: null,
      },
      ...overrides,
    }) satisfies CreateConversationViewResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
