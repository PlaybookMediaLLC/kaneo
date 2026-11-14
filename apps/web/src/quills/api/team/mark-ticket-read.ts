import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["read"].$post;
export type MarkTicketReadRequest = InferRequestType<typeof endpoint>;
export type MarkTicketReadResponse = InferResponseType<typeof endpoint, 200>;
export const markTicketReadKey = (
  input: MarkTicketReadRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "markTicketRead", input);
export async function markTicketRead(
  input: MarkTicketReadRequest,
): Promise<MarkTicketReadResponse> {
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
