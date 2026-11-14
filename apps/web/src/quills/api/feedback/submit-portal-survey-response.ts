import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["surveys"][":surveyId"][
    "responses"
  ].$post;
export type SubmitPortalSurveyResponseRequest = InferRequestType<
  typeof endpoint
>;
export type SubmitPortalSurveyResponseResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const submitPortalSurveyResponseKey = (
  input: SubmitPortalSurveyResponseRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "submitPortalSurveyResponse",
    input,
  );
export async function submitPortalSurveyResponse(
  input: SubmitPortalSurveyResponseRequest,
): Promise<SubmitPortalSurveyResponseResponse> {
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
