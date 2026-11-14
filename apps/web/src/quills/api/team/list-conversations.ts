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

const endpoint = client["quills"][":workspaceId"]["conversations"].$get;
export type ListConversationsRequest = InferRequestType<typeof endpoint>;
export type ListConversationsResponse = InferResponseType<typeof endpoint, 200>;
export const listConversationsKey = (
  input: ListConversationsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "listConversations",
    input,
  );
export async function listConversations(
  input: ListConversationsRequest,
): Promise<ListConversationsResponse> {
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
export const listConversationsQuery = (
  input: ListConversationsRequest,
  viewer: Viewer,
) =>
  queryOptions<ListConversationsResponse, PortalProblem>({
    queryKey: listConversationsKey(input, viewer),
    queryFn: () => listConversations(input),
  });
export const listConversationsInfiniteQuery = (
  input: ListConversationsRequest,
  viewer: Viewer,
) =>
  infiniteQueryOptions<
    ListConversationsResponse,
    PortalProblem,
    InfiniteData<ListConversationsResponse>,
    ReturnType<typeof listConversationsKey>,
    string | undefined
  >({
    queryKey: listConversationsKey(input, viewer),
    initialPageParam: undefined,
    queryFn: ({ pageParam }) =>
      listConversations({
        ...input,
        query: { ...input.query, cursor: pageParam },
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
