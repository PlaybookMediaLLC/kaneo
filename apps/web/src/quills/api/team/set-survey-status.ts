import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["surveys"][":surveyId"]["status"].$put;
export type SetSurveyStatusRequest = InferRequestType<typeof endpoint>;
export type SetSurveyStatusResponse = InferResponseType<typeof endpoint, 200>;
export const setSurveyStatusKey = (
  input: SetSurveyStatusRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "setSurveyStatus", input);
export async function setSurveyStatus(
  input: SetSurveyStatusRequest,
): Promise<SetSurveyStatusResponse> {
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
