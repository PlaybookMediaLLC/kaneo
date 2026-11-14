import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["statuses"].$get;
export type ListStatusesRequest = InferRequestType<typeof endpoint>;
export type ListStatusesResponse = InferResponseType<typeof endpoint, 200>;
export const listStatusesKey = (input: ListStatusesRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "listStatuses", input);
export async function listStatuses(
  input: ListStatusesRequest,
): Promise<ListStatusesResponse> {
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
export const listStatusesQuery = (input: ListStatusesRequest, viewer: Viewer) =>
  queryOptions<ListStatusesResponse, PortalProblem>({
    queryKey: listStatusesKey(input, viewer),
    queryFn: () => listStatuses(input),
  });
