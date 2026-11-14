import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["tags"].$get;
export type ListTagsRequest = InferRequestType<typeof endpoint>;
export type ListTagsResponse = InferResponseType<typeof endpoint, 200>;
export const listTagsKey = (input: ListTagsRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "listTags", input);
export async function listTags(
  input: ListTagsRequest,
): Promise<ListTagsResponse> {
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
export const listTagsQuery = (input: ListTagsRequest, viewer: Viewer) =>
  queryOptions<ListTagsResponse, PortalProblem>({
    queryKey: listTagsKey(input, viewer),
    queryFn: () => listTags(input),
  });
