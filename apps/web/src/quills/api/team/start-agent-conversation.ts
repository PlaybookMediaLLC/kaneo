import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["conversations"].$post;
export type StartAgentConversationRequest = InferRequestType<typeof endpoint>;
export type StartAgentConversationResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const startAgentConversationKey = (
  input: StartAgentConversationRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "startAgentConversation",
    input,
  );
export async function startAgentConversation(
  input: StartAgentConversationRequest,
): Promise<StartAgentConversationResponse> {
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
