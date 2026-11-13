import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["support"]["tickets"].$get;
export type GetMyTicketsRequest = InferRequestType<typeof endpoint>;
export type GetMyTicketsResponse = InferResponseType<typeof endpoint, 200>;
export const getMyTicketsKey = (input: GetMyTicketsRequest, viewer: Viewer) =>
  quillsKey(input.param.workspace, viewer, "support", "getMyTickets", input);
export async function getMyTickets(
  input: GetMyTicketsRequest,
): Promise<GetMyTicketsResponse> {
  try {
    const response = await endpoint(input);
    if (!response.ok) throw await toPortalProblem(response, "record", false);
    return response.json();
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error)
      throw error;
    throw networkPortalProblem();
  }
}
export const getMyTicketsQuery = (input: GetMyTicketsRequest, viewer: Viewer) =>
  queryOptions<GetMyTicketsResponse, PortalProblem>({
    queryKey: getMyTicketsKey(input, viewer),
    queryFn: () => getMyTickets(input),
  });
