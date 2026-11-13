import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills-public"][":workspace"]["hc"].$get;
export type GetPublicHelpCenterRequest = InferRequestType<typeof endpoint>;
export type GetPublicHelpCenterResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getPublicHelpCenterKey = (
  input: GetPublicHelpCenterRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "help-center",
    "getPublicHelpCenter",
    input,
  );
export async function getPublicHelpCenter(
  input: GetPublicHelpCenterRequest,
): Promise<GetPublicHelpCenterResponse> {
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
export const getPublicHelpCenterQuery = (
  input: GetPublicHelpCenterRequest,
  viewer: Viewer,
) =>
  queryOptions<GetPublicHelpCenterResponse, PortalProblem>({
    queryKey: getPublicHelpCenterKey(input, viewer),
    queryFn: () => getPublicHelpCenter(input),
  });
