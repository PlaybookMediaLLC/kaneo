import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["status"]["subscription"].$put;
export type SubscribeStatusRequest = InferRequestType<typeof endpoint>;
export type SubscribeStatusResponse = InferResponseType<typeof endpoint, 200>;
export const subscribeStatusKey = (
  input: SubscribeStatusRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspace, viewer, "portal", "subscribeStatus", input);
export async function subscribeStatus(
  input: SubscribeStatusRequest,
): Promise<SubscribeStatusResponse> {
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
