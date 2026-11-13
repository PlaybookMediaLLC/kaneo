import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills-public"][":workspace"]["portal"]["posts"].$post;
export type CreatePortalPostRequest = InferRequestType<typeof endpoint>;
export type CreatePortalPostResponse = InferResponseType<typeof endpoint, 200>;
export const createPortalPostKey = (
  input: CreatePortalPostRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "createPortalPost",
    input,
  );
export async function createPortalPost(
  input: CreatePortalPostRequest,
): Promise<CreatePortalPostResponse> {
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
