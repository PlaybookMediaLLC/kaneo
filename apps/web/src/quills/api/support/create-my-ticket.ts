import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["support"]["tickets"].$post;
export type CreateMyTicketRequest = InferRequestType<typeof endpoint>;
export type CreateMyTicketResponse = InferResponseType<typeof endpoint, 200>;
export const createMyTicketKey = (
  input: CreateMyTicketRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspace, viewer, "support", "createMyTicket", input);
export async function createMyTicket(
  input: CreateMyTicketRequest,
): Promise<CreateMyTicketResponse> {
  try {
    const response = await endpoint(input);
    if (!response.ok) throw await toPortalProblem(response, "record", false);
    return response.json();
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error)
      throw error;
    throw networkPortalProblem();
  }
}
