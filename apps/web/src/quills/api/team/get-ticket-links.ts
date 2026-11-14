import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["links"].$get;
export type GetTicketLinksRequest = InferRequestType<typeof endpoint>;
export type GetTicketLinksResponse = InferResponseType<typeof endpoint, 200>;
export const getTicketLinksKey = (
  input: GetTicketLinksRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "getTicketLinks", input);
export async function getTicketLinks(
  input: GetTicketLinksRequest,
): Promise<GetTicketLinksResponse> {
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
export const getTicketLinksQuery = (
  input: GetTicketLinksRequest,
  viewer: Viewer,
) =>
  queryOptions<GetTicketLinksResponse, PortalProblem>({
    queryKey: getTicketLinksKey(input, viewer),
    queryFn: () => getTicketLinks(input),
  });
