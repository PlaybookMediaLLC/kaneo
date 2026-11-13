import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills-public"][":workspace"]["unsubscribe"].$get;
export type PreviewUnsubscribeTokenRequest = InferRequestType<typeof endpoint>;
export type PreviewUnsubscribeTokenResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const previewUnsubscribeTokenKey = (
  input: PreviewUnsubscribeTokenRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "notifications",
    "previewUnsubscribeToken",
    input,
  );
export async function previewUnsubscribeToken(
  input: PreviewUnsubscribeTokenRequest,
): Promise<PreviewUnsubscribeTokenResponse> {
  try {
    const response = await endpoint(input);
    if (!response.ok) throw await toPortalProblem(response, "record", true);
    return response.json();
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error)
      throw error;
    throw networkPortalProblem();
  }
}
export const previewUnsubscribeTokenQuery = (
  input: PreviewUnsubscribeTokenRequest,
  viewer: Viewer,
) =>
  queryOptions<PreviewUnsubscribeTokenResponse, PortalProblem>({
    queryKey: previewUnsubscribeTokenKey(input, viewer),
    queryFn: () => previewUnsubscribeToken(input),
  });
