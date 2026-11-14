import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"]["assign"]
    .$post;
export type AssignConversationRequest = InferRequestType<typeof endpoint>;
export type AssignConversationResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const assignConversationKey = (
  input: AssignConversationRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "assignConversation",
    input,
  );
export async function assignConversation(
  input: AssignConversationRequest,
): Promise<AssignConversationResponse> {
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
