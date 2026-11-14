import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"]["status"]
    .$post;
export type SetConversationStatusRequest = InferRequestType<typeof endpoint>;
export type SetConversationStatusResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const setConversationStatusKey = (
  input: SetConversationStatusRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "setConversationStatus",
    input,
  );
export async function setConversationStatus(
  input: SetConversationStatusRequest,
): Promise<SetConversationStatusResponse> {
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
