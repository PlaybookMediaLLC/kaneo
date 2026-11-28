import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"][
    "presence"
  ].$put;
export type SetConversationViewerRequest = InferRequestType<typeof endpoint>;
export type SetConversationViewerResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const setConversationViewerKey = (
  input: SetConversationViewerRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "setConversationViewer",
    input,
  );
export async function setConversationViewer(
  input: SetConversationViewerRequest,
): Promise<SetConversationViewerResponse> {
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
