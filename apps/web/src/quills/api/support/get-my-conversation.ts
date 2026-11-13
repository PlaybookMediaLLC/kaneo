import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["support"]["conversations"][
    ":conversationId"
  ].$get;
export type GetMyConversationRequest = InferRequestType<typeof endpoint>;
export type GetMyConversationResponse = InferResponseType<typeof endpoint, 200>;
export const getMyConversationKey = (
  input: GetMyConversationRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "support",
    "getMyConversation",
    input,
  );
export async function getMyConversation(
  input: GetMyConversationRequest,
): Promise<GetMyConversationResponse> {
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
export const getMyConversationQuery = (
  input: GetMyConversationRequest,
  viewer: Viewer,
) =>
  queryOptions<GetMyConversationResponse, PortalProblem>({
    queryKey: getMyConversationKey(input, viewer),
    queryFn: () => getMyConversation(input),
  });
