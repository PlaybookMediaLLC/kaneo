import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["mute"].$delete;
export type UnmuteTicketRequest = InferRequestType<typeof endpoint>;
export type UnmuteTicketResponse = InferResponseType<typeof endpoint, 200>;
export const unmuteTicketKey = (input: UnmuteTicketRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "unmuteTicket", input);
export async function unmuteTicket(
  input: UnmuteTicketRequest,
): Promise<UnmuteTicketResponse> {
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
