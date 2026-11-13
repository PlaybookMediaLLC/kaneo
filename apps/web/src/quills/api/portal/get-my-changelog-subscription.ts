import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["changelog"]["subscription"].$get;
export type GetMyChangelogSubscriptionRequest = InferRequestType<
  typeof endpoint
>;
export type GetMyChangelogSubscriptionResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getMyChangelogSubscriptionKey = (
  input: GetMyChangelogSubscriptionRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "portal",
    "getMyChangelogSubscription",
    input,
  );
export async function getMyChangelogSubscription(
  input: GetMyChangelogSubscriptionRequest,
): Promise<GetMyChangelogSubscriptionResponse> {
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
export const getMyChangelogSubscriptionQuery = (
  input: GetMyChangelogSubscriptionRequest,
  viewer: Viewer,
) =>
  queryOptions<GetMyChangelogSubscriptionResponse, PortalProblem>({
    queryKey: getMyChangelogSubscriptionKey(input, viewer),
    queryFn: () => getMyChangelogSubscription(input),
  });
