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

const endpoint = client["quills-public"][":workspace"]["portal"]["posts"].$get;
export type ListPortalPostsRequest = InferRequestType<typeof endpoint>;
export type ListPortalPostsResponse = InferResponseType<typeof endpoint, 200>;
export const listPortalPostsKey = (
  input: ListPortalPostsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "listPortalPosts",
    input,
  );
export async function listPortalPosts(
  input: ListPortalPostsRequest,
): Promise<ListPortalPostsResponse> {
  try {
    const response = await endpoint(input);
    if (!response.ok) throw await toPortalProblem(response, "record", false);
    return response.json();
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error)
      throw error;
    throw networkPortalProblem();
  }
}
export const listPortalPostsQuery = (
  input: ListPortalPostsRequest,
  viewer: Viewer,
) =>
  queryOptions<ListPortalPostsResponse, PortalProblem>({
    queryKey: listPortalPostsKey(input, viewer),
    queryFn: () => listPortalPosts(input),
  });
export const listPortalPostsInfiniteQuery = (
  input: ListPortalPostsRequest,
  viewer: Viewer,
) =>
  infiniteQueryOptions<
    ListPortalPostsResponse,
    PortalProblem,
    InfiniteData<ListPortalPostsResponse>,
    ReturnType<typeof listPortalPostsKey>,
    string | undefined
  >({
    queryKey: listPortalPostsKey(input, viewer),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listPortalPosts({
        ...input,
        query: { ...input.query, cursor: pageParam },
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
