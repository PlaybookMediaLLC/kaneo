import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["posts"][":postId"]["board"].$put;
export type SetPostBoardRequest = InferRequestType<typeof endpoint>;
export type SetPostBoardResponse = InferResponseType<typeof endpoint, 200>;
export const setPostBoardKey = (input: SetPostBoardRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "setPostBoard", input);
export async function setPostBoard(
  input: SetPostBoardRequest,
): Promise<SetPostBoardResponse> {
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
