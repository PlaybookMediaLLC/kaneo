import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["posts"][":postId"]["merged"].$get;
export type ListMergedPostsRequest = InferRequestType<typeof endpoint>;
export type ListMergedPostsResponse = InferResponseType<typeof endpoint, 200>;
export const listMergedPostsKey = (
  input: ListMergedPostsRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "listMergedPosts", input);
export async function listMergedPosts(
  input: ListMergedPostsRequest,
): Promise<ListMergedPostsResponse> {
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
export const listMergedPostsQuery = (
  input: ListMergedPostsRequest,
  viewer: Viewer,
) =>
  queryOptions<ListMergedPostsResponse, PortalProblem>({
    queryKey: listMergedPostsKey(input, viewer),
    queryFn: () => listMergedPosts(input),
  });
