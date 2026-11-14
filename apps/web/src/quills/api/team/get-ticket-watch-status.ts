import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["watch"].$get;
export type GetTicketWatchStatusRequest = InferRequestType<typeof endpoint>;
export type GetTicketWatchStatusResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getTicketWatchStatusKey = (
  input: GetTicketWatchStatusRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "getTicketWatchStatus",
    input,
  );
export async function getTicketWatchStatus(
  input: GetTicketWatchStatusRequest,
): Promise<GetTicketWatchStatusResponse> {
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
export const getTicketWatchStatusQuery = (
  input: GetTicketWatchStatusRequest,
  viewer: Viewer,
) =>
  queryOptions<GetTicketWatchStatusResponse, PortalProblem>({
    queryKey: getTicketWatchStatusKey(input, viewer),
    queryFn: () => getTicketWatchStatus(input),
  });
