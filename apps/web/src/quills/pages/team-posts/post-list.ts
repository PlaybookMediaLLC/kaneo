import type { ListPostsResponse } from "../../api/team/list-posts";
import type { ListStatusesResponse } from "../../api/team/list-statuses";
import { plainText } from "../../core/plain-text";
import { statusProgress } from "../../core/status-progress";
import type { ListGroup } from "../../ui/inbox/grouped-list";
import type { InboxBadge } from "../../ui/inbox/inbox-types";

export type ListedPost = ListPostsResponse["items"][number];
type Status = ListStatusesResponse["statuses"][number];

const MONTH = 30 * 86_400_000;
const STALE_MONTHS = 6;

/** The posts under one header per status, in status order. A post without a known status goes last. */
export function groupPosts(
  posts: readonly ListedPost[],
  statuses: readonly Status[],
  noStatus: string,
): ListGroup<ListedPost>[] {
  const known = new Set(statuses.map((status) => status.id));
  return [
    ...[...statuses]
      .sort((a, b) => a.position - b.position)
      .map((status) => ({
        id: status.id,
        label: status.name,
        items: posts.filter((post) => post.statusId === status.id),
      })),
    {
      id: "none",
      label: noStatus,
      items: posts.filter(
        (post) => !post.statusId || !known.has(post.statusId),
      ),
    },
  ];
}

/**
 * The full months since an open post last changed, when there are six or more; else 0.
 * ponytail: `updatedAt` misses new comments and votes; add a last-activity time to
 * listQuillsPosts when the badge must count them.
 */
export function staleMonths(
  post: Pick<ListedPost, "statusId" | "updatedAt">,
  statuses: readonly Status[],
  now = Date.now(),
) {
  const open =
    statuses.find((status) => status.id === post.statusId)?.category ===
    "active";
  const months = Math.floor((now - Date.parse(post.updatedAt)) / MONTH);
  return open && months >= STALE_MONTHS ? months : 0;
}

/** What a request row needs besides its address: the names and the copy of the page. */
export interface RowContext {
  statuses: readonly Status[];
  boardName: ReadonlyMap<string, string>;
  anonymous: string;
  /** The stale badge label, such as "Stale 6mo". */
  stale: (months: number) => string;
}

/** The RequestRow content of a post: plain-text title, stale badge, counts, board, date and author. */
export function postRow(post: ListedPost, context: RowContext, now?: number) {
  const months = staleMonths(post, context.statuses, now);
  const badges: InboxBadge[] = months
    ? [{ id: "stale", label: context.stale(months), tone: "error" }]
    : [];
  return {
    title: plainText(post.title),
    badges,
    votes: post.voteCount,
    comments: post.commentCount,
    board: context.boardName.get(post.boardId) ?? null,
    time: post.createdAt,
    person: { name: post.authorName ?? context.anonymous },
  };
}

/** The PostStatusIcon values of a post: its status color and how far the status is along. */
export const statusIcon = (
  post: Pick<ListedPost, "statusId">,
  statuses: readonly Status[],
) => ({
  color: statuses.find((status) => status.id === post.statusId)?.color ?? null,
  progress: statusProgress(statuses, post.statusId),
});
