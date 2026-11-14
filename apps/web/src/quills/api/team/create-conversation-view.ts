import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["conversation-views"].$post;
export type CreateConversationViewRequest = InferRequestType<typeof endpoint>;
export type CreateConversationViewResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const createConversationViewKey = (
  input: CreateConversationViewRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "createConversationView",
    input,
  );
export async function createConversationView(
  input: CreateConversationViewRequest,
): Promise<CreateConversationViewResponse> {
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
