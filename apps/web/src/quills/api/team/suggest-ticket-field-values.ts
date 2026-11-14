import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["tickets"][":ticketId"]["field-suggestions"]
    .$post;
export type SuggestTicketFieldValuesRequest = InferRequestType<typeof endpoint>;
export type SuggestTicketFieldValuesResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const suggestTicketFieldValuesKey = (
  input: SuggestTicketFieldValuesRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "suggestTicketFieldValues",
    input,
  );
export async function suggestTicketFieldValues(
  input: SuggestTicketFieldValuesRequest,
): Promise<SuggestTicketFieldValuesResponse> {
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
