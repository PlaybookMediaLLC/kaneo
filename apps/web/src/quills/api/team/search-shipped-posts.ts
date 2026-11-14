import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["changelog"]["shipped-posts"].$get;
export type SearchShippedPostsRequest = InferRequestType<typeof endpoint>;
export type SearchShippedPostsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const searchShippedPostsKey = (
  input: SearchShippedPostsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "searchShippedPosts",
    input,
  );
export async function searchShippedPosts(
  input: SearchShippedPostsRequest,
): Promise<SearchShippedPostsResponse> {
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
export const searchShippedPostsQuery = (
  input: SearchShippedPostsRequest,
  viewer: Viewer,
) =>
  queryOptions<SearchShippedPostsResponse, PortalProblem>({
    queryKey: searchShippedPostsKey(input, viewer),
    queryFn: () => searchShippedPosts(input),
  });
