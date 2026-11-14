import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["reply"].$post;
export type ReplyTicketRequest = InferRequestType<typeof endpoint>;
export type ReplyTicketResponse = InferResponseType<typeof endpoint, 200>;
export const replyTicketKey = (input: ReplyTicketRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "replyTicket", input);
export async function replyTicket(
  input: ReplyTicketRequest,
): Promise<ReplyTicketResponse> {
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
