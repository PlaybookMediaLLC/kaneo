import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"].$get;
export type GetConversationRequest = InferRequestType<typeof endpoint>;
export type GetConversationResponse = InferResponseType<typeof endpoint, 200>;
export const getConversationKey = (
  input: GetConversationRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "getConversation", input);
export async function getConversation(
  input: GetConversationRequest,
): Promise<GetConversationResponse> {
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
export const getConversationQuery = (
  input: GetConversationRequest,
  viewer: Viewer,
) =>
  queryOptions<GetConversationResponse, PortalProblem>({
    queryKey: getConversationKey(input, viewer),
    queryFn: () => getConversation(input),
  });
