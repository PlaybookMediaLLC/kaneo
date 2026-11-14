import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["users"].$get;
export type ListUsersRequest = InferRequestType<typeof endpoint>;
export type ListUsersResponse = InferResponseType<typeof endpoint, 200>;
export const listUsersKey = (input: ListUsersRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "listUsers", input);
export async function listUsers(
  input: ListUsersRequest,
): Promise<ListUsersResponse> {
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
export const listUsersQuery = (input: ListUsersRequest, viewer: Viewer) =>
  queryOptions<ListUsersResponse, PortalProblem>({
    queryKey: listUsersKey(input, viewer),
    queryFn: () => listUsers(input),
  });
