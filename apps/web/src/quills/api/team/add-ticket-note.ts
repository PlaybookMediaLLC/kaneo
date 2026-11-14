import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["note"].$post;
export type AddTicketNoteRequest = InferRequestType<typeof endpoint>;
export type AddTicketNoteResponse = InferResponseType<typeof endpoint, 200>;
export const addTicketNoteKey = (input: AddTicketNoteRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "addTicketNote", input);
export async function addTicketNote(
  input: AddTicketNoteRequest,
): Promise<AddTicketNoteResponse> {
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
