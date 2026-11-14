import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["posts"][":postId"].$get;
export type GetPostRequest = InferRequestType<typeof endpoint>;
export type GetPostResponse = InferResponseType<typeof endpoint, 200>;
export const getPostKey = (input: GetPostRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "getPost", input);
export async function getPost(input: GetPostRequest): Promise<GetPostResponse> {
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
export const getPostQuery = (input: GetPostRequest, viewer: Viewer) =>
  queryOptions<GetPostResponse, PortalProblem>({
    queryKey: getPostKey(input, viewer),
    queryFn: () => getPost(input),
  });
