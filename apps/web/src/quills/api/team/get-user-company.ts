import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["users"][":principalId"]["company"].$get;
export type GetUserCompanyRequest = InferRequestType<typeof endpoint>;
export type GetUserCompanyResponse = InferResponseType<typeof endpoint, 200>;
export const getUserCompanyKey = (
  input: GetUserCompanyRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "getUserCompany", input);
export async function getUserCompany(
  input: GetUserCompanyRequest,
): Promise<GetUserCompanyResponse> {
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
export const getUserCompanyQuery = (
  input: GetUserCompanyRequest,
  viewer: Viewer,
) =>
  queryOptions<GetUserCompanyResponse, PortalProblem>({
    queryKey: getUserCompanyKey(input, viewer),
    queryFn: () => getUserCompany(input),
  });
