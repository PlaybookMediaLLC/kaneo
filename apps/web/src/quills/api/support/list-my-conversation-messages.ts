import type { InferRequestType, InferResponseType } from "hono/client";
import { infiniteQueryOptions, type InfiniteData } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["support"]["conversations"][
    ":conversationId"
  ]["messages"].$get;
export type ListMyConversationMessagesRequest = InferRequestType<
  typeof endpoint
>;
export type ListMyConversationMessagesResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listMyConversationMessagesKey = (
  input: ListMyConversationMessagesRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "support",
    "listMyConversationMessages",
    input,
  );
export async function listMyConversationMessages(
  input: ListMyConversationMessagesRequest,
): Promise<ListMyConversationMessagesResponse> {
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
export const listMyConversationMessagesQuery = (
  input: ListMyConversationMessagesRequest,
  viewer: Viewer,
) =>
  infiniteQueryOptions<
    ListMyConversationMessagesResponse,
    PortalProblem,
    InfiniteData<ListMyConversationMessagesResponse>,
    ReturnType<typeof listMyConversationMessagesKey>,
    string | undefined
  >({
    queryKey: listMyConversationMessagesKey(input, viewer),
    initialPageParam: undefined,
    queryFn: ({ pageParam }) =>
      listMyConversationMessages({
        ...input,
        query: { ...input.query, before: pageParam },
      }),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.items[0]?.id : undefined,
  });
