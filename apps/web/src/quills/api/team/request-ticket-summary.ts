import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["summary"].$post;
export type RequestTicketSummaryRequest = InferRequestType<typeof endpoint>;
export type RequestTicketSummaryResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const requestTicketSummaryKey = (
  input: RequestTicketSummaryRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "requestTicketSummary",
    input,
  );
export async function requestTicketSummary(
  input: RequestTicketSummaryRequest,
): Promise<RequestTicketSummaryResponse> {
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
