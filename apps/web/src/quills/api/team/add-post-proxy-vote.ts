import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["posts"][":postId"]["voters"][":principalId"]
    .$put;
export type AddPostProxyVoteRequest = InferRequestType<typeof endpoint>;
export type AddPostProxyVoteResponse = InferResponseType<typeof endpoint, 200>;
export const addPostProxyVoteKey = (
  input: AddPostProxyVoteRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "addPostProxyVote", input);
export async function addPostProxyVote(
  input: AddPostProxyVoteRequest,
): Promise<AddPostProxyVoteResponse> {
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
