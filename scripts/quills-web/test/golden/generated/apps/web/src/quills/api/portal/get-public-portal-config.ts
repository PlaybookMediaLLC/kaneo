import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills-public"][":workspace"]["portal"]["config"].$get;
export type GetPublicPortalConfigRequest = InferRequestType<typeof endpoint>;
export type GetPublicPortalConfigResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getPublicPortalConfigKey = (
  input: GetPublicPortalConfigRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "portal",
    "getPublicPortalConfig",
    input,
  );
export async function getPublicPortalConfig(
  input: GetPublicPortalConfigRequest,
): Promise<GetPublicPortalConfigResponse> {
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
export const getPublicPortalConfigQuery = (
  input: GetPublicPortalConfigRequest,
  viewer: Viewer,
) =>
  queryOptions<GetPublicPortalConfigResponse, PortalProblem>({
    queryKey: getPublicPortalConfigKey(input, viewer),
    queryFn: () => getPublicPortalConfig(input),
  });
