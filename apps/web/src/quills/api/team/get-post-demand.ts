import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["posts"][":postId"]["demand"].$get;
export type GetPostDemandRequest = InferRequestType<typeof endpoint>;
export type GetPostDemandResponse = InferResponseType<typeof endpoint, 200>;
export const getPostDemandKey = (input: GetPostDemandRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "getPostDemand", input);
export async function getPostDemand(
  input: GetPostDemandRequest,
): Promise<GetPostDemandResponse> {
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
export const getPostDemandQuery = (
  input: GetPostDemandRequest,
  viewer: Viewer,
) =>
  queryOptions<GetPostDemandResponse, PortalProblem>({
    queryKey: getPostDemandKey(input, viewer),
    queryFn: () => getPostDemand(input),
  });
