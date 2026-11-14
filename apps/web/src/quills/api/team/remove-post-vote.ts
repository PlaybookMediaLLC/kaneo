import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["posts"][":postId"]["voters"][":principalId"]
    .$delete;
export type RemovePostVoteRequest = InferRequestType<typeof endpoint>;
export type RemovePostVoteResponse = InferResponseType<typeof endpoint, 200>;
export const removePostVoteKey = (
  input: RemovePostVoteRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "removePostVote", input);
export async function removePostVote(
  input: RemovePostVoteRequest,
): Promise<RemovePostVoteResponse> {
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
