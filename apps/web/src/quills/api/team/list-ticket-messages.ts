import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["messages"].$get;
export type ListTicketMessagesRequest = InferRequestType<typeof endpoint>;
export type ListTicketMessagesResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listTicketMessagesKey = (
  input: ListTicketMessagesRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "listTicketMessages",
    input,
  );
export async function listTicketMessages(
  input: ListTicketMessagesRequest,
): Promise<ListTicketMessagesResponse> {
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
export const listTicketMessagesQuery = (
  input: ListTicketMessagesRequest,
  viewer: Viewer,
) =>
  queryOptions<ListTicketMessagesResponse, PortalProblem>({
    queryKey: listTicketMessagesKey(input, viewer),
    queryFn: () => listTicketMessages(input),
  });
