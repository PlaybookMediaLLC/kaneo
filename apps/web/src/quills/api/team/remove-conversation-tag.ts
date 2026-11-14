import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"]["tags"][
    ":tagId"
  ].$delete;
export type RemoveConversationTagRequest = InferRequestType<typeof endpoint>;
export type RemoveConversationTagResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const removeConversationTagKey = (
  input: RemoveConversationTagRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "removeConversationTag",
    input,
  );
export async function removeConversationTag(
  input: RemoveConversationTagRequest,
): Promise<RemoveConversationTagResponse> {
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
