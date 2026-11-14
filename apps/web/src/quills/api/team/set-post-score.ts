import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["posts"][":postId"]["score"].$put;
export type SetPostScoreRequest = InferRequestType<typeof endpoint>;
export type SetPostScoreResponse = InferResponseType<typeof endpoint, 200>;
export const setPostScoreKey = (input: SetPostScoreRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "setPostScore", input);
export async function setPostScore(
  input: SetPostScoreRequest,
): Promise<SetPostScoreResponse> {
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
