import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["teams"].$get;
export type ListTeamsRequest = InferRequestType<typeof endpoint>;
export type ListTeamsResponse = InferResponseType<typeof endpoint, 200>;
export const listTeamsKey = (input: ListTeamsRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "listTeams", input);
export async function listTeams(
  input: ListTeamsRequest,
): Promise<ListTeamsResponse> {
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
export const listTeamsQuery = (input: ListTeamsRequest, viewer: Viewer) =>
  queryOptions<ListTeamsResponse, PortalProblem>({
    queryKey: listTeamsKey(input, viewer),
    queryFn: () => listTeams(input),
  });
