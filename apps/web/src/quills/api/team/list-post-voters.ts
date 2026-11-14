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
  client["quills"][":workspaceId"]["posts"][":postId"]["voters"].$get;
export type ListPostVotersRequest = InferRequestType<typeof endpoint>;
export type ListPostVotersResponse = InferResponseType<typeof endpoint, 200>;
export const listPostVotersKey = (
  input: ListPostVotersRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "listPostVoters", input);
export async function listPostVoters(
  input: ListPostVotersRequest,
): Promise<ListPostVotersResponse> {
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
export const listPostVotersQuery = (
  input: ListPostVotersRequest,
  viewer: Viewer,
) =>
  queryOptions<ListPostVotersResponse, PortalProblem>({
    queryKey: listPostVotersKey(input, viewer),
    queryFn: () => listPostVoters(input),
  });
export const listPostVotersInfiniteQuery = (
  input: ListPostVotersRequest,
  viewer: Viewer,
) =>
  infiniteQueryOptions<
    ListPostVotersResponse,
    PortalProblem,
    InfiniteData<ListPostVotersResponse>,
    ReturnType<typeof listPostVotersKey>,
    number
  >({
    queryKey: listPostVotersKey(input, viewer),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listPostVoters({
        ...input,
        query: { ...input.query, offset: String(pageParam) },
      }),
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });
