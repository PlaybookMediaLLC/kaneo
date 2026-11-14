import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["reporting"]["admin-overview"].$get;
export type FetchAdminOverviewRequest = InferRequestType<typeof endpoint>;
export type FetchAdminOverviewResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const fetchAdminOverviewKey = (
  input: FetchAdminOverviewRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "fetchAdminOverview",
    input,
  );
export async function fetchAdminOverview(
  input: FetchAdminOverviewRequest,
): Promise<FetchAdminOverviewResponse> {
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
export const fetchAdminOverviewQuery = (
  input: FetchAdminOverviewRequest,
  viewer: Viewer,
) =>
  queryOptions<FetchAdminOverviewResponse, PortalProblem>({
    queryKey: fetchAdminOverviewKey(input, viewer),
    queryFn: () => fetchAdminOverview(input),
  });
