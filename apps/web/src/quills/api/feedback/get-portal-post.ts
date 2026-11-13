import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["posts"][":postId"].$get;
export type GetPortalPostRequest = InferRequestType<typeof endpoint>;
export type GetPortalPostResponse = InferResponseType<typeof endpoint, 200>;
export const getPortalPostKey = (input: GetPortalPostRequest, viewer: Viewer) =>
  quillsKey(input.param.workspace, viewer, "feedback", "getPortalPost", input);
export async function getPortalPost(
  input: GetPortalPostRequest,
): Promise<GetPortalPostResponse> {
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
export const getPortalPostQuery = (
  input: GetPortalPostRequest,
  viewer: Viewer,
) =>
  queryOptions<GetPortalPostResponse, PortalProblem>({
    queryKey: getPortalPostKey(input, viewer),
    queryFn: () => getPortalPost(input),
  });
