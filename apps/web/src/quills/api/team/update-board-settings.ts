import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["boards"][":boardId"]["settings"].$patch;
export type UpdateBoardSettingsRequest = InferRequestType<typeof endpoint>;
export type UpdateBoardSettingsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const updateBoardSettingsKey = (
  input: UpdateBoardSettingsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "updateBoardSettings",
    input,
  );
export async function updateBoardSettings(
  input: UpdateBoardSettingsRequest,
): Promise<UpdateBoardSettingsResponse> {
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
