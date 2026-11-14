import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["conversation-tags"].$get;
export type ListConversationTagsRequest = InferRequestType<typeof endpoint>;
export type ListConversationTagsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listConversationTagsKey = (
  input: ListConversationTagsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "listConversationTags",
    input,
  );
export async function listConversationTags(
  input: ListConversationTagsRequest,
): Promise<ListConversationTagsResponse> {
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
export const listConversationTagsQuery = (
  input: ListConversationTagsRequest,
  viewer: Viewer,
) =>
  queryOptions<ListConversationTagsResponse, PortalProblem>({
    queryKey: listConversationTagsKey(input, viewer),
    queryFn: () => listConversationTags(input),
  });
