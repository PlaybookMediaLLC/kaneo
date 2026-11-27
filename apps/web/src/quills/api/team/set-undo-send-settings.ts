import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["support"]["undo-send"].$put;
export type SetUndoSendSettingsRequest = InferRequestType<typeof endpoint>;
export type SetUndoSendSettingsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const setUndoSendSettingsKey = (
  input: SetUndoSendSettingsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "setUndoSendSettings",
    input,
  );
export async function setUndoSendSettings(
  input: SetUndoSendSettingsRequest,
): Promise<SetUndoSendSettingsResponse> {
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
