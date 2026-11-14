import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"]["typing"]
    .$get;
export type GetConversationTypingRequest = InferRequestType<typeof endpoint>;
export type GetConversationTypingResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getConversationTypingKey = (
  input: GetConversationTypingRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "getConversationTyping",
    input,
  );
export async function getConversationTyping(
  input: GetConversationTypingRequest,
): Promise<GetConversationTypingResponse> {
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
export const getConversationTypingQuery = (
  input: GetConversationTypingRequest,
  viewer: Viewer,
) =>
  queryOptions<GetConversationTypingResponse, PortalProblem>({
    queryKey: getConversationTypingKey(input, viewer),
    queryFn: () => getConversationTyping(input),
  });
