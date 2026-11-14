import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["watchers"].$get;
export type ListTicketWatchersRequest = InferRequestType<typeof endpoint>;
export type ListTicketWatchersResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listTicketWatchersKey = (
  input: ListTicketWatchersRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "listTicketWatchers",
    input,
  );
export async function listTicketWatchers(
  input: ListTicketWatchersRequest,
): Promise<ListTicketWatchersResponse> {
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
export const listTicketWatchersQuery = (
  input: ListTicketWatchersRequest,
  viewer: Viewer,
) =>
  queryOptions<ListTicketWatchersResponse, PortalProblem>({
    queryKey: listTicketWatchersKey(input, viewer),
    queryFn: () => listTicketWatchers(input),
  });
