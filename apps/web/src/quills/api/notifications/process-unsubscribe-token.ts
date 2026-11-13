import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["unsubscribe"]["confirm"].$post;
export type ProcessUnsubscribeTokenRequest = InferRequestType<typeof endpoint>;
export type ProcessUnsubscribeTokenResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const processUnsubscribeTokenKey = (
  input: ProcessUnsubscribeTokenRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "notifications",
    "processUnsubscribeToken",
    input,
  );
export async function processUnsubscribeToken(
  input: ProcessUnsubscribeTokenRequest,
): Promise<ProcessUnsubscribeTokenResponse> {
  try {
    const response = await endpoint(input);
    if (!response.ok) throw await toPortalProblem(response, "record", true);
    return response.json();
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error)
      throw error;
    throw networkPortalProblem();
  }
}
