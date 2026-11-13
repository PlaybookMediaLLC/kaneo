import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["support"]["conversations"].$get;
export type ListMyConversationsRequest = InferRequestType<typeof endpoint>;
export type ListMyConversationsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listMyConversationsKey = (
  input: ListMyConversationsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "support",
    "listMyConversations",
    input,
  );
export async function listMyConversations(
  input: ListMyConversationsRequest,
): Promise<ListMyConversationsResponse> {
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
export const listMyConversationsQuery = (
  input: ListMyConversationsRequest,
  viewer: Viewer,
) =>
  queryOptions<ListMyConversationsResponse, PortalProblem>({
    queryKey: listMyConversationsKey(input, viewer),
    queryFn: () => listMyConversations(input),
  });
