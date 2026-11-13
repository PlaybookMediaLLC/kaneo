import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["status"]["subscription"].$get;
export type GetMyStatusSubscriptionRequest = InferRequestType<typeof endpoint>;
export type GetMyStatusSubscriptionResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getMyStatusSubscriptionKey = (
  input: GetMyStatusSubscriptionRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "portal",
    "getMyStatusSubscription",
    input,
  );
export async function getMyStatusSubscription(
  input: GetMyStatusSubscriptionRequest,
): Promise<GetMyStatusSubscriptionResponse> {
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
export const getMyStatusSubscriptionQuery = (
  input: GetMyStatusSubscriptionRequest,
  viewer: Viewer,
) =>
  queryOptions<GetMyStatusSubscriptionResponse, PortalProblem>({
    queryKey: getMyStatusSubscriptionKey(input, viewer),
    queryFn: () => getMyStatusSubscription(input),
  });
