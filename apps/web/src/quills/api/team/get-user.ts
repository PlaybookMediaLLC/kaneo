import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["users"][":principalId"].$get;
export type GetUserRequest = InferRequestType<typeof endpoint>;
export type GetUserResponse = InferResponseType<typeof endpoint, 200>;
export const getUserKey = (input: GetUserRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "getUser", input);
export async function getUser(input: GetUserRequest): Promise<GetUserResponse> {
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
export const getUserQuery = (input: GetUserRequest, viewer: Viewer) =>
  queryOptions<GetUserResponse, PortalProblem>({
    queryKey: getUserKey(input, viewer),
    queryFn: () => getUser(input),
  });
