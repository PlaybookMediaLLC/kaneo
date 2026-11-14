import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"]["read"]
    .$post;
export type MarkConversationReadRequest = InferRequestType<typeof endpoint>;
export type MarkConversationReadResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const markConversationReadKey = (
  input: MarkConversationReadRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "markConversationRead",
    input,
  );
export async function markConversationRead(
  input: MarkConversationReadRequest,
): Promise<MarkConversationReadResponse> {
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
