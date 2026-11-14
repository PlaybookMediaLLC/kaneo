import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["voted-posts"].$get;
export type ListPortalVotedPostsRequest = InferRequestType<typeof endpoint>;
export type ListPortalVotedPostsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listPortalVotedPostsKey = (
  input: ListPortalVotedPostsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "listPortalVotedPosts",
    input,
  );
export async function listPortalVotedPosts(
  input: ListPortalVotedPostsRequest,
): Promise<ListPortalVotedPostsResponse> {
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
export const listPortalVotedPostsQuery = (
  input: ListPortalVotedPostsRequest,
  viewer: Viewer,
) =>
  queryOptions<ListPortalVotedPostsResponse, PortalProblem>({
    queryKey: listPortalVotedPostsKey(input, viewer),
    queryFn: () => listPortalVotedPosts(input),
  });
