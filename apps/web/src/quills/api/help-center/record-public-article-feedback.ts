import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["hc"]["articles"][":articleId"][
    "feedback"
  ].$post;
export type RecordPublicArticleFeedbackRequest = InferRequestType<
  typeof endpoint
>;
export type RecordPublicArticleFeedbackResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const recordPublicArticleFeedbackKey = (
  input: RecordPublicArticleFeedbackRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "help-center",
    "recordPublicArticleFeedback",
    input,
  );
export async function recordPublicArticleFeedback(
  input: RecordPublicArticleFeedbackRequest,
): Promise<RecordPublicArticleFeedbackResponse> {
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
