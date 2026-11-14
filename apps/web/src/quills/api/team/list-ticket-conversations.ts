import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["conversations"]
    .$get;
export type ListTicketConversationsRequest = InferRequestType<typeof endpoint>;
export type ListTicketConversationsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listTicketConversationsKey = (
  input: ListTicketConversationsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "listTicketConversations",
    input,
  );
export async function listTicketConversations(
  input: ListTicketConversationsRequest,
): Promise<ListTicketConversationsResponse> {
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
export const listTicketConversationsQuery = (
  input: ListTicketConversationsRequest,
  viewer: Viewer,
) =>
  queryOptions<ListTicketConversationsResponse, PortalProblem>({
    queryKey: listTicketConversationsKey(input, viewer),
    queryFn: () => listTicketConversations(input),
  });
