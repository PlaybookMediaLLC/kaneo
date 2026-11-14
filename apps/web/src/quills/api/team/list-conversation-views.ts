import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["conversation-views"].$get;
export type ListConversationViewsRequest = InferRequestType<typeof endpoint>;
export type ListConversationViewsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listConversationViewsKey = (
  input: ListConversationViewsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "listConversationViews",
    input,
  );
export async function listConversationViews(
  input: ListConversationViewsRequest,
): Promise<ListConversationViewsResponse> {
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
export const listConversationViewsQuery = (
  input: ListConversationViewsRequest,
  viewer: Viewer,
) =>
  queryOptions<ListConversationViewsResponse, PortalProblem>({
    queryKey: listConversationViewsKey(input, viewer),
    queryFn: () => listConversationViews(input),
  });
