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

const endpoint = client["quills"][":workspaceId"]["changelog-engagement"].$get;
export type ListChangelogEngagementRequest = InferRequestType<typeof endpoint>;
export type ListChangelogEngagementResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listChangelogEngagementKey = (
  input: ListChangelogEngagementRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "listChangelogEngagement",
    input,
  );
export async function listChangelogEngagement(
  input: ListChangelogEngagementRequest,
): Promise<ListChangelogEngagementResponse> {
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
export const listChangelogEngagementQuery = (
  input: ListChangelogEngagementRequest,
  viewer: Viewer,
) =>
  queryOptions<ListChangelogEngagementResponse, PortalProblem>({
    queryKey: listChangelogEngagementKey(input, viewer),
    queryFn: () => listChangelogEngagement(input),
  });
export const listChangelogEngagementInfiniteQuery = (
  input: ListChangelogEngagementRequest,
  viewer: Viewer,
) =>
  infiniteQueryOptions<
    ListChangelogEngagementResponse,
    PortalProblem,
    InfiniteData<ListChangelogEngagementResponse>,
    ReturnType<typeof listChangelogEngagementKey>,
    number
  >({
    queryKey: listChangelogEngagementKey(input, viewer),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listChangelogEngagement({
        ...input,
        query: { ...input.query, offset: String(pageParam) },
      }),
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });
