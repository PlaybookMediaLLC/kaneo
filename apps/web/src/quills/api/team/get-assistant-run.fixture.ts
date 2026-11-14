import type { GetAssistantRunResponse } from "./get-assistant-run";
export const getAssistantRunFixture = {
  ok: (overrides: Partial<GetAssistantRunResponse> = {}) =>
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
    }) satisfies GetAssistantRunResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
