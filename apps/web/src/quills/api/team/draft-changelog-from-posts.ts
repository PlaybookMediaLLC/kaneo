import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["changelog"]["drafts"].$post;
export type DraftChangelogFromPostsRequest = InferRequestType<typeof endpoint>;
export type DraftChangelogFromPostsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const draftChangelogFromPostsKey = (
  input: DraftChangelogFromPostsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "draftChangelogFromPosts",
    input,
  );
export async function draftChangelogFromPosts(
  input: DraftChangelogFromPostsRequest,
): Promise<DraftChangelogFromPostsResponse> {
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
