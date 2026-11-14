import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["watch"].$delete;
export type UnwatchTicketRequest = InferRequestType<typeof endpoint>;
export type UnwatchTicketResponse = InferResponseType<typeof endpoint, 200>;
export const unwatchTicketKey = (input: UnwatchTicketRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "unwatchTicket", input);
export async function unwatchTicket(
  input: UnwatchTicketRequest,
): Promise<UnwatchTicketResponse> {
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
