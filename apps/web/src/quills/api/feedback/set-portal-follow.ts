import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["posts"][":postId"]["follow"]
    .$put;
export type SetPortalFollowRequest = InferRequestType<typeof endpoint>;
export type SetPortalFollowResponse = InferResponseType<typeof endpoint, 200>;
export const setPortalFollowKey = (
  input: SetPortalFollowRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "setPortalFollow",
    input,
  );
export async function setPortalFollow(
  input: SetPortalFollowRequest,
): Promise<SetPortalFollowResponse> {
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
