import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["surveys"]["active"].$get;
export type GetPortalActiveSurveyRequest = InferRequestType<typeof endpoint>;
export type GetPortalActiveSurveyResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getPortalActiveSurveyKey = (
  input: GetPortalActiveSurveyRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "getPortalActiveSurvey",
    input,
  );
export async function getPortalActiveSurvey(
  input: GetPortalActiveSurveyRequest,
): Promise<GetPortalActiveSurveyResponse> {
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
export const getPortalActiveSurveyQuery = (
  input: GetPortalActiveSurveyRequest,
  viewer: Viewer,
) =>
  queryOptions<GetPortalActiveSurveyResponse, PortalProblem>({
    queryKey: getPortalActiveSurveyKey(input, viewer),
    queryFn: () => getPortalActiveSurvey(input),
  });
