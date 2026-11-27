import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["support"]["undo-send"].$get;
export type GetUndoSendSettingsRequest = InferRequestType<typeof endpoint>;
export type GetUndoSendSettingsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getUndoSendSettingsKey = (
  input: GetUndoSendSettingsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "getUndoSendSettings",
    input,
  );
export async function getUndoSendSettings(
  input: GetUndoSendSettingsRequest,
): Promise<GetUndoSendSettingsResponse> {
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
export const getUndoSendSettingsQuery = (
  input: GetUndoSendSettingsRequest,
  viewer: Viewer,
) =>
  queryOptions<GetUndoSendSettingsResponse, PortalProblem>({
    queryKey: getUndoSendSettingsKey(input, viewer),
    queryFn: () => getUndoSendSettings(input),
  });
