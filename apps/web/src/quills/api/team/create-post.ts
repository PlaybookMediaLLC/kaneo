import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["posts"].$post;
export type CreatePostRequest = InferRequestType<typeof endpoint>;
export type CreatePostResponse = InferResponseType<typeof endpoint, 200>;
export const createPostKey = (input: CreatePostRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "createPost", input);
export async function createPost(
  input: CreatePostRequest,
): Promise<CreatePostResponse> {
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
