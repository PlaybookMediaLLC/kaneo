import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["changelog"][":entryId"][
    "reactions"
  ].$put;
export type SetPortalChangelogReactionRequest = InferRequestType<
  typeof endpoint
>;
export type SetPortalChangelogReactionResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const setPortalChangelogReactionKey = (
  input: SetPortalChangelogReactionRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "changelog",
    "setPortalChangelogReaction",
    input,
  );
export async function setPortalChangelogReaction(
  input: SetPortalChangelogReactionRequest,
): Promise<SetPortalChangelogReactionResponse> {
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
