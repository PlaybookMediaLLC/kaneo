import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["tickets"][":ticketId"].$get;
export type GetTicketRequest = InferRequestType<typeof endpoint>;
export type GetTicketResponse = InferResponseType<typeof endpoint, 200>;
export const getTicketKey = (input: GetTicketRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "getTicket", input);
export async function getTicket(
  input: GetTicketRequest,
): Promise<GetTicketResponse> {
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
export const getTicketQuery = (input: GetTicketRequest, viewer: Viewer) =>
  queryOptions<GetTicketResponse, PortalProblem>({
    queryKey: getTicketKey(input, viewer),
    queryFn: () => getTicket(input),
  });
