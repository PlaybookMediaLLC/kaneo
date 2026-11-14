import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["users"][":principalId"]["block"].$put;
export type BlockUserRequest = InferRequestType<typeof endpoint>;
export type BlockUserResponse = InferResponseType<typeof endpoint, 200>;
export const blockUserKey = (input: BlockUserRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "blockUser", input);
export async function blockUser(
  input: BlockUserRequest,
): Promise<BlockUserResponse> {
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
