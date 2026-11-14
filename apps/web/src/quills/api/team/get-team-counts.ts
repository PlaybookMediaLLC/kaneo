import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["reporting"]["team-counts"].$get;
export type GetTeamCountsRequest = InferRequestType<typeof endpoint>;
export type GetTeamCountsResponse = InferResponseType<typeof endpoint, 200>;
export const getTeamCountsKey = (input: GetTeamCountsRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "getTeamCounts", input);
export async function getTeamCounts(
  input: GetTeamCountsRequest,
): Promise<GetTeamCountsResponse> {
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
export const getTeamCountsQuery = (
  input: GetTeamCountsRequest,
  viewer: Viewer,
) =>
  queryOptions<GetTeamCountsResponse, PortalProblem>({
    queryKey: getTeamCountsKey(input, viewer),
    queryFn: () => getTeamCounts(input),
  });
