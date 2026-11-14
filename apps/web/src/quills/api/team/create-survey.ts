import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["surveys"].$post;
export type CreateSurveyRequest = InferRequestType<typeof endpoint>;
export type CreateSurveyResponse = InferResponseType<typeof endpoint, 200>;
export const createSurveyKey = (input: CreateSurveyRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "createSurvey", input);
export async function createSurvey(
  input: CreateSurveyRequest,
): Promise<CreateSurveyResponse> {
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
