import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["posts"][":postId"]["unmerge"].$post;
export type UnmergePostRequest = InferRequestType<typeof endpoint>;
export type UnmergePostResponse = InferResponseType<typeof endpoint, 200>;
export const unmergePostKey = (input: UnmergePostRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "unmergePost", input);
export async function unmergePost(
  input: UnmergePostRequest,
): Promise<UnmergePostResponse> {
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
