import type { GetPostDemandResponse } from "./get-post-demand";
export const getPostDemandFixture = {
  ok: (overrides: Partial<GetPostDemandResponse> = {}) =>
    ({
      ...{
        voters: 0,
        companies: 0,
        mrrCents: 0,
        importance: { nice: 0, important: 0, critical: 0 },
        postId: "post_id_test_1",
        segments: [],
      },
      ...overrides,
    }) satisfies GetPostDemandResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
