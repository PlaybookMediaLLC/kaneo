import type { ListBoardsResponse } from "../../api/team/list-boards";
import type { ListPostsResponse } from "../../api/team/list-posts";
import type { ListStatusesResponse } from "../../api/team/list-statuses";

// A small feedback inbox for the tests of the inbox and the post view.
const created = "2026-01-01T00:00:00.000Z";
const status = (
  id: string,
  name: string,
  category: "active" | "complete" | "closed",
  position: number,
) => ({
  id,
  name,
  slug: id,
  color: "gray",
  category,
  position,
  showOnRoadmap: true,
  isDefault: position === 0,
  createdAt: created,
});

export const inboxStatuses = {
  statuses: [
    status("status_open", "Open", "active", 0),
    status("status_planned", "Planned", "active", 1),
    status("status_done", "Complete", "complete", 2),
  ],
  nextOffset: null,
} satisfies ListStatusesResponse;

export const inboxBoards = {
  items: [
    {
      id: "board_ideas",
      name: "Ideas",
      slug: "ideas",
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
      createdAt: created,
      updatedAt: created,
    },
  ],
  nextOffset: null,
} satisfies ListBoardsResponse;

const post = (id: string, title: string, statusId: string, votes: number) => ({
  id,
  boardId: "board_ideas",
  title,
  content: `${title} details`,
  statusId,
  principalId: "principal_author",
  authorName: "Ada",
  ownerPrincipalId: null,
  voteCount: votes,
  commentCount: 0,
  pinnedCommentId: null,
  isCommentsLocked: false,
  moderationState: "published",
  canonicalPostId: null,
  eta: null,
  createdAt: created,
  updatedAt: created,
  deletedAt: null,
  tags: [{ id: "tag_api", name: "API", color: "gray" }],
  score: {
    reach: null,
    impact: null,
    confidence: null,
    effort: null,
    rice: null,
  },
  demand: {
    voters: votes,
    companies: 0,
    mrrCents: 0,
    importance: { nice: 0, important: 0, critical: 0 },
  },
});

export const inboxPosts = {
  items: [
    post("post_export", "Export to CSV", "status_open", 3),
    post("post_sso", "Single sign-on", "status_planned", 1),
  ],
  nextCursor: null,
  hasMore: false,
} satisfies ListPostsResponse;
