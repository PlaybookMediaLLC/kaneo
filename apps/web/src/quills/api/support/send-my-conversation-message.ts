import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["support"]["conversations"][
    ":conversationId"
  ]["messages"].$post;
export type SendMyConversationMessageRequest = InferRequestType<
  typeof endpoint
>;
export type SendMyConversationMessageResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const sendMyConversationMessageKey = (
  input: SendMyConversationMessageRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "support",
    "sendMyConversationMessage",
    input,
  );
export async function sendMyConversationMessage(
  input: SendMyConversationMessageRequest,
): Promise<SendMyConversationMessageResponse> {
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
