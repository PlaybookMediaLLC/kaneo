import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["assign"].$post;
export type AssignTicketRequest = InferRequestType<typeof endpoint>;
export type AssignTicketResponse = InferResponseType<typeof endpoint, 200>;
export const assignTicketKey = (input: AssignTicketRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "assignTicket", input);
export async function assignTicket(
  input: AssignTicketRequest,
): Promise<AssignTicketResponse> {
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
