import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["statuses"].$get;
export type ListPortalStatusesRequest = InferRequestType<typeof endpoint>;
export type ListPortalStatusesResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listPortalStatusesKey = (
  input: ListPortalStatusesRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "listPortalStatuses",
    input,
  );
export async function listPortalStatuses(
  input: ListPortalStatusesRequest,
): Promise<ListPortalStatusesResponse> {
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
export const listPortalStatusesQuery = (
  input: ListPortalStatusesRequest,
  viewer: Viewer,
) =>
  queryOptions<ListPortalStatusesResponse, PortalProblem>({
    queryKey: listPortalStatusesKey(input, viewer),
    queryFn: () => listPortalStatuses(input),
  });
