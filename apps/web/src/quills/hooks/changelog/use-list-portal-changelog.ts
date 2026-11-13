import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import {
  listPortalChangelog,
  listPortalChangelogKey,
  type ListPortalChangelogRequest,
  type ListPortalChangelogResponse,
} from "../../api/changelog/list-portal-changelog";
export function useListPortalChangelog(
  input: ListPortalChangelogRequest,
  viewer: Viewer,
) {
  return useInfiniteQuery<
    ListPortalChangelogResponse,
    PortalProblem,
    InfiniteData<ListPortalChangelogResponse>,
    ReturnType<typeof listPortalChangelogKey>,
    number
  >({
    queryKey: listPortalChangelogKey(input, viewer),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listPortalChangelog({
        ...input,
        query: { ...input.query, offset: String(pageParam) },
      }),
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: Boolean(input.param.workspace),
  });
}
