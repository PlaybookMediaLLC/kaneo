import { z } from "zod";
import type { ListPostsRequest } from "../../api/team/list-posts";
import type { ListStatusesResponse } from "../../api/team/list-statuses";

/** The inbox filters in the address. The post view keeps them, so Back and J/K use the same list. */
export const postSearch = z.object({
  status: z
    .enum(["active", "complete", "closed", "all"])
    .optional()
    .catch(undefined),
  board: z.string().max(100).optional().catch(undefined),
  /** One status, as the sidebar opens it. It replaces the status tab. */
  statusId: z.string().max(100).optional().catch(undefined),
  q: z.string().max(200).optional().catch(undefined),
  sort: z.enum(["newest", "votes", "rice"]).optional().catch(undefined),
});
export type PostSearch = z.infer<typeof postSearch>;
export type PostTab = NonNullable<PostSearch["status"]>;

type Status = ListStatusesResponse["statuses"][number];

/** The board and search filters, which the list and the tab counts share. */
export const postFilterQuery = (search: PostSearch) => ({
  ...(search.board ? { boardIds: search.board } : {}),
  ...(search.q ? { search: search.q } : {}),
});

/**
 * The listQuillsPosts input of the inbox. A status ID filters one status. A status tab is a status category, so the
 * request waits for the statuses. `none` is true when the tab has no status: the list is
 * then empty, because an empty statusIds filter matches every post.
 */
export function postListInput(
  workspaceId: string,
  search: PostSearch,
  statuses: readonly Status[] | undefined,
) {
  const tab = search.status ?? "active";
  const ids = search.statusId
    ? [search.statusId]
    : tab === "all"
      ? []
      : (statuses ?? [])
          .filter((status) => status.category === tab)
          .map((status) => status.id);
  const none = Boolean(statuses) && tab !== "all" && ids.length === 0;
  const input: ListPostsRequest = {
    param: { workspaceId: statuses && !none ? workspaceId : "" },
    query: {
      sort: search.sort ?? "newest",
      limit: "50",
      ...(ids.length ? { statusIds: ids.join(",") } : {}),
      ...postFilterQuery(search),
    },
  };
  return { input, none };
}
