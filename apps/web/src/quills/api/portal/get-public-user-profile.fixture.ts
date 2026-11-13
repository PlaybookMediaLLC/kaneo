import type { GetPublicUserProfileResponse } from "./get-public-user-profile";
export const getPublicUserProfileFixture = {
  ok: (overrides: Partial<GetPublicUserProfileResponse> = {}) =>
    ({
      ...{
        principalId: "principal_id_test_1",
        displayName: "value",
        avatarUrl: null,
        isTeamMember: false,
        joinedAt: "2026-01-01T00:00:00.000Z",
        postCount: 0,
        commentCount: 0,
        posts: [],
        comments: [],
      },
      ...overrides,
    }) satisfies GetPublicUserProfileResponse,
  problem: (status: 403 | 404) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
