import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["feedback-signals"][":signalId"]["dismiss"]
    .$post;
export type DismissFeedbackSignalRequest = InferRequestType<typeof endpoint>;
export type DismissFeedbackSignalResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const dismissFeedbackSignalKey = (
  input: DismissFeedbackSignalRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "dismissFeedbackSignal",
    input,
  );
export async function dismissFeedbackSignal(
  input: DismissFeedbackSignalRequest,
): Promise<DismissFeedbackSignalResponse> {
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
