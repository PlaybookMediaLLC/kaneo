import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["feedback"]["insights"].$get;
export type GetFeedbackInsightsRequest = InferRequestType<typeof endpoint>;
export type GetFeedbackInsightsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getFeedbackInsightsKey = (
  input: GetFeedbackInsightsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "getFeedbackInsights",
    input,
  );
export async function getFeedbackInsights(
  input: GetFeedbackInsightsRequest,
): Promise<GetFeedbackInsightsResponse> {
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
export const getFeedbackInsightsQuery = (
  input: GetFeedbackInsightsRequest,
  viewer: Viewer,
) =>
  queryOptions<GetFeedbackInsightsResponse, PortalProblem>({
    queryKey: getFeedbackInsightsKey(input, viewer),
    queryFn: () => getFeedbackInsights(input),
  });
