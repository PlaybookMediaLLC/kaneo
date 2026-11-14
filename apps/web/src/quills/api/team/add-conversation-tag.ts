import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"]["tags"]
    .$post;
export type AddConversationTagRequest = InferRequestType<typeof endpoint>;
export type AddConversationTagResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const addConversationTagKey = (
  input: AddConversationTagRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "addConversationTag",
    input,
  );
export async function addConversationTag(
  input: AddConversationTagRequest,
): Promise<AddConversationTagResponse> {
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
