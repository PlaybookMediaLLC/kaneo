import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"]["ticket"]
    .$get;
export type GetConversationTicketLinkRequest = InferRequestType<
  typeof endpoint
>;
export type GetConversationTicketLinkResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getConversationTicketLinkKey = (
  input: GetConversationTicketLinkRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "getConversationTicketLink",
    input,
  );
export async function getConversationTicketLink(
  input: GetConversationTicketLinkRequest,
): Promise<GetConversationTicketLinkResponse> {
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
export const getConversationTicketLinkQuery = (
  input: GetConversationTicketLinkRequest,
  viewer: Viewer,
) =>
  queryOptions<GetConversationTicketLinkResponse, PortalProblem>({
    queryKey: getConversationTicketLinkKey(input, viewer),
    queryFn: () => getConversationTicketLink(input),
  });
