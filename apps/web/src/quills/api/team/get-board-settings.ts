import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["boards"][":boardId"]["settings"].$get;
export type GetBoardSettingsRequest = InferRequestType<typeof endpoint>;
export type GetBoardSettingsResponse = InferResponseType<typeof endpoint, 200>;
export const getBoardSettingsKey = (
  input: GetBoardSettingsRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "getBoardSettings", input);
export async function getBoardSettings(
  input: GetBoardSettingsRequest,
): Promise<GetBoardSettingsResponse> {
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
export const getBoardSettingsQuery = (
  input: GetBoardSettingsRequest,
  viewer: Viewer,
) =>
  queryOptions<GetBoardSettingsResponse, PortalProblem>({
    queryKey: getBoardSettingsKey(input, viewer),
    queryFn: () => getBoardSettings(input),
  });
