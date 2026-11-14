import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["comments"][":commentId"][
    "reactions"
  ].$put;
export type SetPortalCommentReactionRequest = InferRequestType<typeof endpoint>;
export type SetPortalCommentReactionResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const setPortalCommentReactionKey = (
  input: SetPortalCommentReactionRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "setPortalCommentReaction",
    input,
  );
export async function setPortalCommentReaction(
  input: SetPortalCommentReactionRequest,
): Promise<SetPortalCommentReactionResponse> {
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
