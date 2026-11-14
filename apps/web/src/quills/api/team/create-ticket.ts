import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["tickets"].$post;
export type CreateTicketRequest = InferRequestType<typeof endpoint>;
export type CreateTicketResponse = InferResponseType<typeof endpoint, 200>;
export const createTicketKey = (input: CreateTicketRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "createTicket", input);
export async function createTicket(
  input: CreateTicketRequest,
): Promise<CreateTicketResponse> {
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
