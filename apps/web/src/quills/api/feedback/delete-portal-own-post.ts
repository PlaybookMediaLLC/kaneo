import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["posts"][":postId"].$delete;
export type DeletePortalOwnPostRequest = InferRequestType<typeof endpoint>;
export type DeletePortalOwnPostResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const deletePortalOwnPostKey = (
  input: DeletePortalOwnPostRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "deletePortalOwnPost",
    input,
  );
export async function deletePortalOwnPost(
  input: DeletePortalOwnPostRequest,
): Promise<DeletePortalOwnPostResponse> {
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
