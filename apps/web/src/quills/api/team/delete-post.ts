import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["posts"][":postId"].$delete;
export type DeletePostRequest = InferRequestType<typeof endpoint>;
export type DeletePostResponse = InferResponseType<typeof endpoint, 200>;
export const deletePostKey = (input: DeletePostRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "deletePost", input);
export async function deletePost(
  input: DeletePostRequest,
): Promise<DeletePostResponse> {
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
