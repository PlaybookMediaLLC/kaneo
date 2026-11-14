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

const endpoint =
  client["quills"][":workspaceId"]["posts"][":postId"]["comments"].$get;
export type ListPostCommentsRequest = InferRequestType<typeof endpoint>;
export type ListPostCommentsResponse = InferResponseType<typeof endpoint, 200>;
export const listPostCommentsKey = (
  input: ListPostCommentsRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "listPostComments", input);
export async function listPostComments(
  input: ListPostCommentsRequest,
): Promise<ListPostCommentsResponse> {
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
export const listPostCommentsQuery = (
  input: ListPostCommentsRequest,
  viewer: Viewer,
) =>
  queryOptions<ListPostCommentsResponse, PortalProblem>({
    queryKey: listPostCommentsKey(input, viewer),
    queryFn: () => listPostComments(input),
  });
export const listPostCommentsInfiniteQuery = (
  input: ListPostCommentsRequest,
  viewer: Viewer,
) =>
  infiniteQueryOptions<
    ListPostCommentsResponse,
    PortalProblem,
    InfiniteData<ListPostCommentsResponse>,
    ReturnType<typeof listPostCommentsKey>,
    number
  >({
    queryKey: listPostCommentsKey(input, viewer),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listPostComments({
        ...input,
        query: { ...input.query, offset: String(pageParam) },
      }),
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });
