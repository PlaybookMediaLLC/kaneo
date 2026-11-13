import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["status"]["incidents"][":incidentId"]
    .$get;
export type GetPublicStatusIncidentRequest = InferRequestType<typeof endpoint>;
export type GetPublicStatusIncidentResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getPublicStatusIncidentKey = (
  input: GetPublicStatusIncidentRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "status",
    "getPublicStatusIncident",
    input,
  );
export async function getPublicStatusIncident(
  input: GetPublicStatusIncidentRequest,
): Promise<GetPublicStatusIncidentResponse> {
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
export const getPublicStatusIncidentQuery = (
  input: GetPublicStatusIncidentRequest,
  viewer: Viewer,
) =>
  queryOptions<GetPublicStatusIncidentResponse, PortalProblem>({
    queryKey: getPublicStatusIncidentKey(input, viewer),
    queryFn: () => getPublicStatusIncident(input),
  });
