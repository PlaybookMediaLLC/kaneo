import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["surveys"][":surveyId"]["results"].$get;
export type GetSurveyResultsRequest = InferRequestType<typeof endpoint>;
export type GetSurveyResultsResponse = InferResponseType<typeof endpoint, 200>;
export const getSurveyResultsKey = (
  input: GetSurveyResultsRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "getSurveyResults", input);
export async function getSurveyResults(
  input: GetSurveyResultsRequest,
): Promise<GetSurveyResultsResponse> {
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
export const getSurveyResultsQuery = (
  input: GetSurveyResultsRequest,
  viewer: Viewer,
) =>
  queryOptions<GetSurveyResultsResponse, PortalProblem>({
    queryKey: getSurveyResultsKey(input, viewer),
    queryFn: () => getSurveyResults(input),
  });
