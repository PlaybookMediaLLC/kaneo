import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["ticket-statuses"].$get;
export type ListTicketStatusesRequest = InferRequestType<typeof endpoint>;
export type ListTicketStatusesResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listTicketStatusesKey = (
  input: ListTicketStatusesRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "listTicketStatuses",
    input,
  );
export async function listTicketStatuses(
  input: ListTicketStatusesRequest,
): Promise<ListTicketStatusesResponse> {
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
export const listTicketStatusesQuery = (
  input: ListTicketStatusesRequest,
  viewer: Viewer,
) =>
  queryOptions<ListTicketStatusesResponse, PortalProblem>({
    queryKey: listTicketStatusesKey(input, viewer),
    queryFn: () => listTicketStatuses(input),
  });
