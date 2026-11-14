import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["activity"].$get;
export type ListTicketActivityRequest = InferRequestType<typeof endpoint>;
export type ListTicketActivityResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listTicketActivityKey = (
  input: ListTicketActivityRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "listTicketActivity",
    input,
  );
export async function listTicketActivity(
  input: ListTicketActivityRequest,
): Promise<ListTicketActivityResponse> {
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
export const listTicketActivityQuery = (
  input: ListTicketActivityRequest,
  viewer: Viewer,
) =>
  queryOptions<ListTicketActivityResponse, PortalProblem>({
    queryKey: listTicketActivityKey(input, viewer),
    queryFn: () => listTicketActivity(input),
  });
