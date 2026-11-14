import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["feedback"]["revenue-at-risk"].$get;
export type GetRevenueAtRiskRequest = InferRequestType<typeof endpoint>;
export type GetRevenueAtRiskResponse = InferResponseType<typeof endpoint, 200>;
export const getRevenueAtRiskKey = (
  input: GetRevenueAtRiskRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "getRevenueAtRisk", input);
export async function getRevenueAtRisk(
  input: GetRevenueAtRiskRequest,
): Promise<GetRevenueAtRiskResponse> {
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
export const getRevenueAtRiskQuery = (
  input: GetRevenueAtRiskRequest,
  viewer: Viewer,
) =>
  queryOptions<GetRevenueAtRiskResponse, PortalProblem>({
    queryKey: getRevenueAtRiskKey(input, viewer),
    queryFn: () => getRevenueAtRisk(input),
  });
