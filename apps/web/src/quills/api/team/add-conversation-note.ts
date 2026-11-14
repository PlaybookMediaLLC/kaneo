import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"]["note"]
    .$post;
export type AddConversationNoteRequest = InferRequestType<typeof endpoint>;
export type AddConversationNoteResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const addConversationNoteKey = (
  input: AddConversationNoteRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "addConversationNote",
    input,
  );
export async function addConversationNote(
  input: AddConversationNoteRequest,
): Promise<AddConversationNoteResponse> {
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
