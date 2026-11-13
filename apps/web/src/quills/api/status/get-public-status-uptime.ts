import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills-public"][":workspace"]["status"]["uptime"].$get;
export type GetPublicStatusUptimeRequest = InferRequestType<typeof endpoint>;
export type GetPublicStatusUptimeResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getPublicStatusUptimeKey = (
  input: GetPublicStatusUptimeRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "status",
    "getPublicStatusUptime",
    input,
  );
export async function getPublicStatusUptime(
  input: GetPublicStatusUptimeRequest,
): Promise<GetPublicStatusUptimeResponse> {
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
export const getPublicStatusUptimeQuery = (
  input: GetPublicStatusUptimeRequest,
  viewer: Viewer,
) =>
  queryOptions<GetPublicStatusUptimeResponse, PortalProblem>({
    queryKey: getPublicStatusUptimeKey(input, viewer),
    queryFn: () => getPublicStatusUptime(input),
  });
