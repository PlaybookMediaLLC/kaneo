import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["comments"][":commentId"]
    .$put;
export type EditPortalOwnCommentRequest = InferRequestType<typeof endpoint>;
export type EditPortalOwnCommentResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const editPortalOwnCommentKey = (
  input: EditPortalOwnCommentRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "editPortalOwnComment",
    input,
  );
export async function editPortalOwnComment(
  input: EditPortalOwnCommentRequest,
): Promise<EditPortalOwnCommentResponse> {
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
