import type { InferRequestType, InferResponseType } from "hono/client";
import {
  infiniteQueryOptions,
  queryOptions,
  type InfiniteData,
} from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["posts"].$get;
export type ListPostsRequest = InferRequestType<typeof endpoint>;
export type ListPostsResponse = InferResponseType<typeof endpoint, 200>;
export const listPostsKey = (input: ListPostsRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "listPosts", input);
export async function listPosts(
  input: ListPostsRequest,
): Promise<ListPostsResponse> {
  try {
    const response = await endpoint(input);
    if (!response.ok) throw await toPortalProblem(response, "teammate", false);
    return response.json();
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error)
      throw error;
    throw networkPortalProblem();
  }
}
export const listPostsQuery = (input: ListPostsRequest, viewer: Viewer) =>
  queryOptions<ListPostsResponse, PortalProblem>({
    queryKey: listPostsKey(input, viewer),
    queryFn: () => listPosts(input),
  });
export const listPostsInfiniteQuery = (
  input: ListPostsRequest,
  viewer: Viewer,
) =>
  infiniteQueryOptions<
    ListPostsResponse,
    PortalProblem,
    InfiniteData<ListPostsResponse>,
    ReturnType<typeof listPostsKey>,
    string | undefined
  >({
    queryKey: listPostsKey(input, viewer),
    initialPageParam: undefined,
    queryFn: ({ pageParam }) =>
      listPosts({ ...input, query: { ...input.query, cursor: pageParam } }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
