import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversation-attributes"].$get;
export type ListConversationAttributesRequest = InferRequestType<
  typeof endpoint
>;
export type ListConversationAttributesResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listConversationAttributesKey = (
  input: ListConversationAttributesRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "listConversationAttributes",
    input,
  );
export async function listConversationAttributes(
  input: ListConversationAttributesRequest,
): Promise<ListConversationAttributesResponse> {
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
export const listConversationAttributesQuery = (
  input: ListConversationAttributesRequest,
  viewer: Viewer,
) =>
  queryOptions<ListConversationAttributesResponse, PortalProblem>({
    queryKey: listConversationAttributesKey(input, viewer),
    queryFn: () => listConversationAttributes(input),
  });
