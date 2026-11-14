import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"]["posts"]
    .$post;
export type CreatePostFromConversationRequest = InferRequestType<
  typeof endpoint
>;
export type CreatePostFromConversationResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const createPostFromConversationKey = (
  input: CreatePostFromConversationRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "createPostFromConversation",
    input,
  );
export async function createPostFromConversation(
  input: CreatePostFromConversationRequest,
): Promise<CreatePostFromConversationResponse> {
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
