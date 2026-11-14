import type { GetPostFilterCountsResponse } from "../../api/team/get-post-filter-counts";
import type { ListPostsResponse } from "../../api/team/list-posts";
import type { ListStatusesResponse } from "../../api/team/list-statuses";
import type { ListGroup } from "../../ui/inbox/grouped-list";
import type { PostTab } from "./post-search";

export type ListedPost = ListPostsResponse["items"][number];
type Status = ListStatusesResponse["statuses"][number];

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

/** The ListRow content of a post: author, title, text, then chips for votes, board and tags. */
export function postRow(
  post: ListedPost,
  boardName: string | undefined,
  labels: { votes: string; anonymous: string },
) {
  return {
    person: { name: post.authorName ?? labels.anonymous },
    title: post.title,
    preview: post.content,
    time: post.createdAt,
    chips: [
      { id: "votes", label: labels.votes },
      ...(boardName ? [{ id: "board", label: boardName }] : []),
      ...post.tags.map((tag) => ({ id: tag.id, label: tag.name })),
    ],
  };
}

/** The post count of each status tab. "All" leaves out the rare post without a status. */
export function tabCounts(
  statuses: readonly Status[],
  counts: GetPostFilterCountsResponse,
): Record<PostTab, number> {
  const total = { active: 0, complete: 0, closed: 0, all: 0 };
  const category = new Map(statuses.map((s) => [s.id, s.category]));
  for (const { id, count } of counts.statuses) {
    const tab = category.get(id);
    if (tab) total[tab] += count;
    total.all += count;
  }
  return total;
}
