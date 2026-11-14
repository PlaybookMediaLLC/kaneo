import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["links"].$get;
export type ListLinksRequest = InferRequestType<typeof endpoint>;
export type ListLinksResponse = InferResponseType<typeof endpoint, 200>;
export const listLinksKey = (input: ListLinksRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "listLinks", input);
export async function listLinks(
  input: ListLinksRequest,
): Promise<ListLinksResponse> {
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
export const listLinksQuery = (input: ListLinksRequest, viewer: Viewer) =>
  queryOptions<ListLinksResponse, PortalProblem>({
    queryKey: listLinksKey(input, viewer),
    queryFn: () => listLinks(input),
  });
