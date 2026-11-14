import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["posts"][":postId"]["tags"].$put;
export type SetPostTagsRequest = InferRequestType<typeof endpoint>;
export type SetPostTagsResponse = InferResponseType<typeof endpoint, 200>;
export const setPostTagsKey = (input: SetPostTagsRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "setPostTags", input);
export async function setPostTags(
  input: SetPostTagsRequest,
): Promise<SetPostTagsResponse> {
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
