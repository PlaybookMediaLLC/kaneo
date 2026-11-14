import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["external-links"]
    .$get;
export type ListTicketExternalLinksRequest = InferRequestType<typeof endpoint>;
export type ListTicketExternalLinksResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listTicketExternalLinksKey = (
  input: ListTicketExternalLinksRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "listTicketExternalLinks",
    input,
  );
export async function listTicketExternalLinks(
  input: ListTicketExternalLinksRequest,
): Promise<ListTicketExternalLinksResponse> {
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
export const listTicketExternalLinksQuery = (
  input: ListTicketExternalLinksRequest,
  viewer: Viewer,
) =>
  queryOptions<ListTicketExternalLinksResponse, PortalProblem>({
    queryKey: listTicketExternalLinksKey(input, viewer),
    queryFn: () => listTicketExternalLinks(input),
  });
