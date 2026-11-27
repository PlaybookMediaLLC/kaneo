import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["presence"].$put;
export type SetTicketViewerRequest = InferRequestType<typeof endpoint>;
export type SetTicketViewerResponse = InferResponseType<typeof endpoint, 200>;
export const setTicketViewerKey = (
  input: SetTicketViewerRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "setTicketViewer", input);
export async function setTicketViewer(
  input: SetTicketViewerRequest,
): Promise<SetTicketViewerResponse> {
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
