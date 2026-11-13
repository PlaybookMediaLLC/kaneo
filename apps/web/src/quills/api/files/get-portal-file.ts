import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["files"][":fileId"].$get;
export type GetPortalFileRequest = InferRequestType<typeof endpoint>;
export type GetPortalFileResponse = InferResponseType<typeof endpoint, 200>;
export const getPortalFileKey = (input: GetPortalFileRequest, viewer: Viewer) =>
  quillsKey(input.param.workspace, viewer, "files", "getPortalFile", input);
export async function getPortalFile(
  input: GetPortalFileRequest,
): Promise<GetPortalFileResponse> {
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
export const getPortalFileQuery = (
  input: GetPortalFileRequest,
  viewer: Viewer,
) =>
  queryOptions<GetPortalFileResponse, PortalProblem>({
    queryKey: getPortalFileKey(input, viewer),
    queryFn: () => getPortalFile(input),
  });
