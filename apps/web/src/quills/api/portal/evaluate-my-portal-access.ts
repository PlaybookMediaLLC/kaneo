import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills-public"][":workspace"]["portal"]["access"].$get;
export type EvaluateMyPortalAccessRequest = InferRequestType<typeof endpoint>;
export type EvaluateMyPortalAccessResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const evaluateMyPortalAccessKey = (
  input: EvaluateMyPortalAccessRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "portal",
    "evaluateMyPortalAccess",
    input,
  );
export async function evaluateMyPortalAccess(
  input: EvaluateMyPortalAccessRequest,
): Promise<EvaluateMyPortalAccessResponse> {
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
export const evaluateMyPortalAccessQuery = (
  input: EvaluateMyPortalAccessRequest,
  viewer: Viewer,
) =>
  queryOptions<EvaluateMyPortalAccessResponse, PortalProblem>({
    queryKey: evaluateMyPortalAccessKey(input, viewer),
    queryFn: () => evaluateMyPortalAccess(input),
  });
