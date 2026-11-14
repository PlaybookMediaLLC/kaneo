import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["suggestions"][":suggestionId"]["restore"]
    .$post;
export type RestoreSuggestionRequest = InferRequestType<typeof endpoint>;
export type RestoreSuggestionResponse = InferResponseType<typeof endpoint, 200>;
export const restoreSuggestionKey = (
  input: RestoreSuggestionRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "restoreSuggestion",
    input,
  );
export async function restoreSuggestion(
  input: RestoreSuggestionRequest,
): Promise<RestoreSuggestionResponse> {
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
