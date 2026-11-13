import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["roadmaps"][":roadmapId"][
    "posts"
  ].$get;
export type ListPortalRoadmapPostsRequest = InferRequestType<typeof endpoint>;
export type ListPortalRoadmapPostsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listPortalRoadmapPostsKey = (
  input: ListPortalRoadmapPostsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "listPortalRoadmapPosts",
    input,
  );
export async function listPortalRoadmapPosts(
  input: ListPortalRoadmapPostsRequest,
): Promise<ListPortalRoadmapPostsResponse> {
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
export const listPortalRoadmapPostsQuery = (
  input: ListPortalRoadmapPostsRequest,
  viewer: Viewer,
) =>
  queryOptions<ListPortalRoadmapPostsResponse, PortalProblem>({
    queryKey: listPortalRoadmapPostsKey(input, viewer),
    queryFn: () => listPortalRoadmapPosts(input),
  });
