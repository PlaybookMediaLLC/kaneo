import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["posts"]["counts"].$get;
export type GetPostFilterCountsRequest = InferRequestType<typeof endpoint>;
export type GetPostFilterCountsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getPostFilterCountsKey = (
  input: GetPostFilterCountsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "getPostFilterCounts",
    input,
  );
export async function getPostFilterCounts(
  input: GetPostFilterCountsRequest,
): Promise<GetPostFilterCountsResponse> {
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
export const getPostFilterCountsQuery = (
  input: GetPostFilterCountsRequest,
  viewer: Viewer,
) =>
  queryOptions<GetPostFilterCountsResponse, PortalProblem>({
    queryKey: getPostFilterCountsKey(input, viewer),
    queryFn: () => getPostFilterCounts(input),
  });
