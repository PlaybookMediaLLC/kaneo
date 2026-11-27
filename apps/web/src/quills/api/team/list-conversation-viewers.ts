import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"][
    "presence"
  ].$get;
export type ListConversationViewersRequest = InferRequestType<typeof endpoint>;
export type ListConversationViewersResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listConversationViewersKey = (
  input: ListConversationViewersRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "listConversationViewers",
    input,
  );
export async function listConversationViewers(
  input: ListConversationViewersRequest,
): Promise<ListConversationViewersResponse> {
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
export const listConversationViewersQuery = (
  input: ListConversationViewersRequest,
  viewer: Viewer,
) =>
  queryOptions<ListConversationViewersResponse, PortalProblem>({
    queryKey: listConversationViewersKey(input, viewer),
    queryFn: () => listConversationViewers(input),
  });
