import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["posts"][":postId"]["merge"].$post;
export type MergePostRequest = InferRequestType<typeof endpoint>;
export type MergePostResponse = InferResponseType<typeof endpoint, 200>;
export const mergePostKey = (input: MergePostRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "mergePost", input);
export async function mergePost(
  input: MergePostRequest,
): Promise<MergePostResponse> {
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
