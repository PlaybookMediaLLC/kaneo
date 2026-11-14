import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["segments"].$get;
export type ListSegmentsRequest = InferRequestType<typeof endpoint>;
export type ListSegmentsResponse = InferResponseType<typeof endpoint, 200>;
export const listSegmentsKey = (input: ListSegmentsRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "listSegments", input);
export async function listSegments(
  input: ListSegmentsRequest,
): Promise<ListSegmentsResponse> {
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
export const listSegmentsQuery = (input: ListSegmentsRequest, viewer: Viewer) =>
  queryOptions<ListSegmentsResponse, PortalProblem>({
    queryKey: listSegmentsKey(input, viewer),
    queryFn: () => listSegments(input),
  });
