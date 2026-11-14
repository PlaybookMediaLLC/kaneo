import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["suggestions"][":suggestionId"]["accept"]
    .$post;
export type AcceptSuggestionRequest = InferRequestType<typeof endpoint>;
export type AcceptSuggestionResponse = InferResponseType<typeof endpoint, 200>;
export const acceptSuggestionKey = (
  input: AcceptSuggestionRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "acceptSuggestion", input);
export async function acceptSuggestion(
  input: AcceptSuggestionRequest,
): Promise<AcceptSuggestionResponse> {
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
