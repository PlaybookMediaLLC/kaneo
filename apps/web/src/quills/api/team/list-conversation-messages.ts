import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["conversations"][":conversationId"][
    "messages"
  ].$get;
export type ListConversationMessagesRequest = InferRequestType<typeof endpoint>;
export type ListConversationMessagesResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listConversationMessagesKey = (
  input: ListConversationMessagesRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "listConversationMessages",
    input,
  );
export async function listConversationMessages(
  input: ListConversationMessagesRequest,
): Promise<ListConversationMessagesResponse> {
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
export const listConversationMessagesQuery = (
  input: ListConversationMessagesRequest,
  viewer: Viewer,
) =>
  queryOptions<ListConversationMessagesResponse, PortalProblem>({
    queryKey: listConversationMessagesKey(input, viewer),
    queryFn: () => listConversationMessages(input),
  });
