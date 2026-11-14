import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["priority"].$post;
export type SetTicketPriorityRequest = InferRequestType<typeof endpoint>;
export type SetTicketPriorityResponse = InferResponseType<typeof endpoint, 200>;
export const setTicketPriorityKey = (
  input: SetTicketPriorityRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "setTicketPriority",
    input,
  );
export async function setTicketPriority(
  input: SetTicketPriorityRequest,
): Promise<SetTicketPriorityResponse> {
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
