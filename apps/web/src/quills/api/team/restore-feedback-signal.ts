import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["feedback-signals"][":signalId"]["restore"]
    .$post;
export type RestoreFeedbackSignalRequest = InferRequestType<typeof endpoint>;
export type RestoreFeedbackSignalResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const restoreFeedbackSignalKey = (
  input: RestoreFeedbackSignalRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "restoreFeedbackSignal",
    input,
  );
export async function restoreFeedbackSignal(
  input: RestoreFeedbackSignalRequest,
): Promise<RestoreFeedbackSignalResponse> {
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
