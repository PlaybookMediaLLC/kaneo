import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["presence"].$get;
export type ListTicketViewersRequest = InferRequestType<typeof endpoint>;
export type ListTicketViewersResponse = InferResponseType<typeof endpoint, 200>;
export const listTicketViewersKey = (
  input: ListTicketViewersRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "listTicketViewers",
    input,
  );
export async function listTicketViewers(
  input: ListTicketViewersRequest,
): Promise<ListTicketViewersResponse> {
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
export const listTicketViewersQuery = (
  input: ListTicketViewersRequest,
  viewer: Viewer,
) =>
  queryOptions<ListTicketViewersResponse, PortalProblem>({
    queryKey: listTicketViewersKey(input, viewer),
    queryFn: () => listTicketViewers(input),
  });
