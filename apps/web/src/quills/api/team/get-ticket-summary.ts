import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["summary"].$get;
export type GetTicketSummaryRequest = InferRequestType<typeof endpoint>;
export type GetTicketSummaryResponse = InferResponseType<typeof endpoint, 200>;
export const getTicketSummaryKey = (
  input: GetTicketSummaryRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "getTicketSummary", input);
export async function getTicketSummary(
  input: GetTicketSummaryRequest,
): Promise<GetTicketSummaryResponse> {
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
export const getTicketSummaryQuery = (
  input: GetTicketSummaryRequest,
  viewer: Viewer,
) =>
  queryOptions<GetTicketSummaryResponse, PortalProblem>({
    queryKey: getTicketSummaryKey(input, viewer),
    queryFn: () => getTicketSummary(input),
  });
