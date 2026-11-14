import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["mute"].$put;
export type MuteTicketRequest = InferRequestType<typeof endpoint>;
export type MuteTicketResponse = InferResponseType<typeof endpoint, 200>;
export const muteTicketKey = (input: MuteTicketRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "muteTicket", input);
export async function muteTicket(
  input: MuteTicketRequest,
): Promise<MuteTicketResponse> {
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
