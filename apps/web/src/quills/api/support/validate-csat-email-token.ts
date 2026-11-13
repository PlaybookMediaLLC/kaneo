import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["support"]["csat-email"].$get;
export type ValidateCsatEmailTokenRequest = InferRequestType<typeof endpoint>;
export type ValidateCsatEmailTokenResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const validateCsatEmailTokenKey = (
  input: ValidateCsatEmailTokenRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "support",
    "validateCsatEmailToken",
    input,
  );
export async function validateCsatEmailToken(
  input: ValidateCsatEmailTokenRequest,
): Promise<ValidateCsatEmailTokenResponse> {
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
export const validateCsatEmailTokenQuery = (
  input: ValidateCsatEmailTokenRequest,
  viewer: Viewer,
) =>
  queryOptions<ValidateCsatEmailTokenResponse, PortalProblem>({
    queryKey: validateCsatEmailTokenKey(input, viewer),
    queryFn: () => validateCsatEmailToken(input),
  });
