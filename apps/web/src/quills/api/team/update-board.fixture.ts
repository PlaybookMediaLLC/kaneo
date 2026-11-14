import type { UpdateBoardResponse } from "./update-board";
export const updateBoardFixture = {
  ok: (overrides: Partial<UpdateBoardResponse> = {}) =>
    ({
      ...{
        id: "id_test_1",
        name: "value",
        slug: "value",
        description: null,
        access: {
          view: "anonymous",
          vote: "anonymous",
          comment: "anonymous",
          submit: "anonymous",
          segments: { view: [], vote: [], comment: [], submit: [] },
          moderation: {
            anonPosts: "inherit",
            signedPosts: "inherit",
            comments: "inherit",
          },
        },
        visibleSegmentIds: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      ...overrides,
    }) satisfies UpdateBoardResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
