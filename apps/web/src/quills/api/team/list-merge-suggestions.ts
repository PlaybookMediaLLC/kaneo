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

const endpoint = client["quills"][":workspaceId"]["merge-suggestions"].$get;
export type ListMergeSuggestionsRequest = InferRequestType<typeof endpoint>;
export type ListMergeSuggestionsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listMergeSuggestionsKey = (
  input: ListMergeSuggestionsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "listMergeSuggestions",
    input,
  );
export async function listMergeSuggestions(
  input: ListMergeSuggestionsRequest,
): Promise<ListMergeSuggestionsResponse> {
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
export const listMergeSuggestionsQuery = (
  input: ListMergeSuggestionsRequest,
  viewer: Viewer,
) =>
  queryOptions<ListMergeSuggestionsResponse, PortalProblem>({
    queryKey: listMergeSuggestionsKey(input, viewer),
    queryFn: () => listMergeSuggestions(input),
  });
export const listMergeSuggestionsInfiniteQuery = (
  input: ListMergeSuggestionsRequest,
  viewer: Viewer,
) =>
  infiniteQueryOptions<
    ListMergeSuggestionsResponse,
    PortalProblem,
    InfiniteData<ListMergeSuggestionsResponse>,
    ReturnType<typeof listMergeSuggestionsKey>,
    number
  >({
    queryKey: listMergeSuggestionsKey(input, viewer),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listMergeSuggestions({
        ...input,
        query: { ...input.query, offset: String(pageParam) },
      }),
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });
