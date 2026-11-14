import type { GetPostResponse } from "../../api/team/get-post";
import type { GetPostDemandResponse } from "../../api/team/get-post-demand";
import type { ListPostCommentsResponse } from "../../api/team/list-post-comments";
import type { ListPostVotersResponse } from "../../api/team/list-post-voters";
import type { TeamRuntimeValue } from "../../team/runtime";

// One post of the test inbox (inbox.fixture.ts) with its thread, voters and demand.
const created = "2026-01-01T00:00:00.000Z";

/** The runtime that the app shell gives a part, with every Quills permission. */
export const postTeam: TeamRuntimeValue = {
  workspaceId: "workspace_test_1",
  viewer: { kind: "user", id: "user_test_1" },
  permissions: {
    read: true,
    create: true,
    update: true,
    delete: true,
    manageSettings: true,
  },
};

// Annotated, not `satisfies`, so a test can change a nullable field.
export const postDetail: GetPostResponse = {
  id: "post_export",
  boardId: "board_ideas",
  title: "Export to CSV",
  content: "We need a CSV export of the monthly report.",
  statusId: "status_open",
  principalId: "principal_author",
  authorName: "Ada",
  ownerPrincipalId: null,
  voteCount: 3,
  commentCount: 3,
  pinnedCommentId: null,
  isCommentsLocked: false,
  moderationState: "published",
  canonicalPostId: null,
  eta: null,
  createdAt: created,
  updatedAt: created,
  deletedAt: null,
  tags: [{ id: "tag_api", name: "API", color: "gray" }],
  score: { reach: 100, impact: 2, confidence: 80, effort: 4, rice: 40 },
  hasVoted: false,
  widgetMetadata: null,
};

const comment = (
  id: string,
  content: string,
  team: boolean,
  isPrivate = false,
) => ({
  id,
  postId: "post_export",
  parentId: null,
  principalId: team ? "principal_team" : "principal_customer",
  authorName: team ? "Grace" : "Linus",
  content,
  isTeamMember: team,
  isPrivate,
  moderationState: "published",
  createdAt: created,
  updatedAt: null,
  deletedAt: null,
  isRemovedByTeam: false,
  reactions: [],
});

export const postComments = {
  items: [
    comment("comment_customer", "Same for us, every month.", false),
    comment("comment_reply", "Thanks, we plan it for June.", true),
    comment(
      "comment_note",
      "Two enterprise accounts ask for this.",
      true,
      true,
    ),
  ],
  nextOffset: null,
} satisfies ListPostCommentsResponse;

export const postVoters = {
  items: [
    {
      principalId: "principal_customer",
      displayName: "Linus",
      avatarUrl: null,
      isAnonymous: false,
      sourceType: null,
      addedByPrincipalId: null,
      importance: "critical",
      createdAt: created,
    },
    {
      principalId: "principal_proxy",
      displayName: "Margaret",
      avatarUrl: null,
      isAnonymous: false,
      sourceType: "proxy",
      addedByPrincipalId: "principal_team",
      importance: null,
      createdAt: created,
    },
  ],
  nextOffset: null,
} satisfies ListPostVotersResponse;

export const postDemand = {
  postId: "post_export",
  voters: 3,
  companies: 2,
  mrrCents: 150000,
  importance: { nice: 1, important: 1, critical: 1 },
  segments: [{ id: "segment_enterprise", name: "Enterprise", voters: 2 }],
} satisfies GetPostDemandResponse;
