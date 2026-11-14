import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"][
    "summary"
  ].$post;
export type RequestConversationSummaryRequest = InferRequestType<
  typeof endpoint
>;
export type RequestConversationSummaryResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const requestConversationSummaryKey = (
  input: RequestConversationSummaryRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "requestConversationSummary",
    input,
  );
export async function requestConversationSummary(
  input: RequestConversationSummaryRequest,
): Promise<RequestConversationSummaryResponse> {
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
