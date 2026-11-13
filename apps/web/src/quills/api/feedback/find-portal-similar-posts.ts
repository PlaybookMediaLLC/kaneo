import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["posts"]["similar"].$get;
export type FindPortalSimilarPostsRequest = InferRequestType<typeof endpoint>;
export type FindPortalSimilarPostsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const findPortalSimilarPostsKey = (
  input: FindPortalSimilarPostsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "findPortalSimilarPosts",
    input,
  );
export async function findPortalSimilarPosts(
  input: FindPortalSimilarPostsRequest,
): Promise<FindPortalSimilarPostsResponse> {
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
export const findPortalSimilarPostsQuery = (
  input: FindPortalSimilarPostsRequest,
  viewer: Viewer,
) =>
  queryOptions<FindPortalSimilarPostsResponse, PortalProblem>({
    queryKey: findPortalSimilarPostsKey(input, viewer),
    queryFn: () => findPortalSimilarPosts(input),
  });
