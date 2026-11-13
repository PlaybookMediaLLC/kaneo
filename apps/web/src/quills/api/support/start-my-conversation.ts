import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["support"]["conversations"].$post;
export type StartMyConversationRequest = InferRequestType<typeof endpoint>;
export type StartMyConversationResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const startMyConversationKey = (
  input: StartMyConversationRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "support",
    "startMyConversation",
    input,
  );
export async function startMyConversation(
  input: StartMyConversationRequest,
): Promise<StartMyConversationResponse> {
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
