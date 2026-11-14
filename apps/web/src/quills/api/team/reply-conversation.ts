import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"]["reply"]
    .$post;
export type ReplyConversationRequest = InferRequestType<typeof endpoint>;
export type ReplyConversationResponse = InferResponseType<typeof endpoint, 200>;
export const replyConversationKey = (
  input: ReplyConversationRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "replyConversation",
    input,
  );
export async function replyConversation(
  input: ReplyConversationRequest,
): Promise<ReplyConversationResponse> {
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
