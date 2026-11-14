import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["user"]["stats"].$get;
export type GetPortalUserStatsRequest = InferRequestType<typeof endpoint>;
export type GetPortalUserStatsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getPortalUserStatsKey = (
  input: GetPortalUserStatsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "getPortalUserStats",
    input,
  );
export async function getPortalUserStats(
  input: GetPortalUserStatsRequest,
): Promise<GetPortalUserStatsResponse> {
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
export const getPortalUserStatsQuery = (
  input: GetPortalUserStatsRequest,
  viewer: Viewer,
) =>
  queryOptions<GetPortalUserStatsResponse, PortalProblem>({
    queryKey: getPortalUserStatsKey(input, viewer),
    queryFn: () => getPortalUserStats(input),
  });
