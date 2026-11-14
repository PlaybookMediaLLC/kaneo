import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["status"].$post;
export type SetTicketStatusRequest = InferRequestType<typeof endpoint>;
export type SetTicketStatusResponse = InferResponseType<typeof endpoint, 200>;
export const setTicketStatusKey = (
  input: SetTicketStatusRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "setTicketStatus", input);
export async function setTicketStatus(
  input: SetTicketStatusRequest,
): Promise<SetTicketStatusResponse> {
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
