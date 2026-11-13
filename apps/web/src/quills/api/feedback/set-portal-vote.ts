import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["posts"][":postId"]["vote"]
    .$put;
export type SetPortalVoteRequest = InferRequestType<typeof endpoint>;
export type SetPortalVoteResponse = InferResponseType<typeof endpoint, 200>;
export const setPortalVoteKey = (input: SetPortalVoteRequest, viewer: Viewer) =>
  quillsKey(input.param.workspace, viewer, "feedback", "setPortalVote", input);
export async function setPortalVote(
  input: SetPortalVoteRequest,
): Promise<SetPortalVoteResponse> {
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
