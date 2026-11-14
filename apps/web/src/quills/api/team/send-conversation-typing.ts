import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"]["typing"]
    .$put;
export type SendConversationTypingRequest = InferRequestType<typeof endpoint>;
export type SendConversationTypingResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const sendConversationTypingKey = (
  input: SendConversationTypingRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "sendConversationTyping",
    input,
  );
export async function sendConversationTyping(
  input: SendConversationTypingRequest,
): Promise<SendConversationTypingResponse> {
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
