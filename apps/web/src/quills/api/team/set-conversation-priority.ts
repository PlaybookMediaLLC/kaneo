import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"][
    "priority"
  ].$post;
export type SetConversationPriorityRequest = InferRequestType<typeof endpoint>;
export type SetConversationPriorityResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const setConversationPriorityKey = (
  input: SetConversationPriorityRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "setConversationPriority",
    input,
  );
export async function setConversationPriority(
  input: SetConversationPriorityRequest,
): Promise<SetConversationPriorityResponse> {
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
