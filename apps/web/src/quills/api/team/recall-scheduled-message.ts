import type { InferRequestType, InferResponseType } from "hono/client";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";

const recallEndpoint =
  client["quills"][":workspaceId"]["conversation-messages"][":messageId"][
    "recall"
  ].$post;
const sendNowEndpoint =
  client["quills"][":workspaceId"]["conversation-messages"][":messageId"][
    "send-now"
  ].$post;

export type RecallScheduledMessageRequest = InferRequestType<
  typeof recallEndpoint
>;
export type RecallScheduledMessageResponse = InferResponseType<
  typeof recallEndpoint,
  200
>;
export type SendScheduledMessageNowRequest = InferRequestType<
  typeof sendNowEndpoint
>;
export type SendScheduledMessageNowResponse = InferResponseType<
  typeof sendNowEndpoint,
  200
>;

export async function recallScheduledMessage(
  input: RecallScheduledMessageRequest,
): Promise<RecallScheduledMessageResponse> {
  try {
    const response = await recallEndpoint(input);
    if (!response.ok) throw await toPortalProblem(response, "teammate", false);
    return response.json();
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error)
      throw error;
    throw networkPortalProblem();
  }
}

export async function sendScheduledMessageNow(
  input: SendScheduledMessageNowRequest,
): Promise<SendScheduledMessageNowResponse> {
  try {
    const response = await sendNowEndpoint(input);
    if (!response.ok) throw await toPortalProblem(response, "teammate", false);
    return response.json();
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error)
      throw error;
    throw networkPortalProblem();
  }
}
