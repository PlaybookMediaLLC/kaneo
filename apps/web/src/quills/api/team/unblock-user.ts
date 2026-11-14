import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["users"][":principalId"]["block"].$delete;
export type UnblockUserRequest = InferRequestType<typeof endpoint>;
export type UnblockUserResponse = InferResponseType<typeof endpoint, 200>;
export const unblockUserKey = (input: UnblockUserRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "unblockUser", input);
export async function unblockUser(
  input: UnblockUserRequest,
): Promise<UnblockUserResponse> {
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
