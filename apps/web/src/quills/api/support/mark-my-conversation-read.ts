import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["support"]["conversations"][
    ":conversationId"
  ]["read"].$put;
export type MarkMyConversationReadRequest = InferRequestType<typeof endpoint>;
export type MarkMyConversationReadResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const markMyConversationReadKey = (
  input: MarkMyConversationReadRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "support",
    "markMyConversationRead",
    input,
  );
export async function markMyConversationRead(
  input: MarkMyConversationReadRequest,
): Promise<MarkMyConversationReadResponse> {
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
