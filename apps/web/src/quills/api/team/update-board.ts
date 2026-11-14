import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["boards"][":boardId"].$patch;
export type UpdateBoardRequest = InferRequestType<typeof endpoint>;
export type UpdateBoardResponse = InferResponseType<typeof endpoint, 200>;
export const updateBoardKey = (input: UpdateBoardRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "updateBoard", input);
export async function updateBoard(
  input: UpdateBoardRequest,
): Promise<UpdateBoardResponse> {
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
