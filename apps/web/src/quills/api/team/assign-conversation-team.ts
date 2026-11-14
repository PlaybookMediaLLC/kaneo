import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"]["team"]
    .$put;
export type AssignConversationTeamRequest = InferRequestType<typeof endpoint>;
export type AssignConversationTeamResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const assignConversationTeamKey = (
  input: AssignConversationTeamRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "assignConversationTeam",
    input,
  );
export async function assignConversationTeam(
  input: AssignConversationTeamRequest,
): Promise<AssignConversationTeamResponse> {
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
