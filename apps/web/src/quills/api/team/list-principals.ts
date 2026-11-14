import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["principals"].$get;
export type ListPrincipalsRequest = InferRequestType<typeof endpoint>;
export type ListPrincipalsResponse = InferResponseType<typeof endpoint, 200>;
export const listPrincipalsKey = (
  input: ListPrincipalsRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "listPrincipals", input);
export async function listPrincipals(
  input: ListPrincipalsRequest,
): Promise<ListPrincipalsResponse> {
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
export const listPrincipalsQuery = (
  input: ListPrincipalsRequest,
  viewer: Viewer,
) =>
  queryOptions<ListPrincipalsResponse, PortalProblem>({
    queryKey: listPrincipalsKey(input, viewer),
    queryFn: () => listPrincipals(input),
  });
