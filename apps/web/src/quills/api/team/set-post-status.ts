import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["posts"][":postId"]["status"].$put;
export type SetPostStatusRequest = InferRequestType<typeof endpoint>;
export type SetPostStatusResponse = InferResponseType<typeof endpoint, 200>;
export const setPostStatusKey = (input: SetPostStatusRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "setPostStatus", input);
export async function setPostStatus(
  input: SetPostStatusRequest,
): Promise<SetPostStatusResponse> {
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
