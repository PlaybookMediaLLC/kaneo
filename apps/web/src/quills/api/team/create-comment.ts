import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["posts"][":postId"]["comments"].$post;
export type CreateCommentRequest = InferRequestType<typeof endpoint>;
export type CreateCommentResponse = InferResponseType<typeof endpoint, 200>;
export const createCommentKey = (input: CreateCommentRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "createComment", input);
export async function createComment(
  input: CreateCommentRequest,
): Promise<CreateCommentResponse> {
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
