import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"][
    "restore-spam"
  ].$post;
export type RestoreConversationFromSpamRequest = InferRequestType<
  typeof endpoint
>;
export type RestoreConversationFromSpamResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const restoreConversationFromSpamKey = (
  input: RestoreConversationFromSpamRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "restoreConversationFromSpam",
    input,
  );
export async function restoreConversationFromSpam(
  input: RestoreConversationFromSpamRequest,
): Promise<RestoreConversationFromSpamResponse> {
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
