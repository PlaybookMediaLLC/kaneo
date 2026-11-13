import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills-public"][":workspace"]["user"]["language"].$get;
export type GetMyLanguagePreferenceRequest = InferRequestType<typeof endpoint>;
export type GetMyLanguagePreferenceResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getMyLanguagePreferenceKey = (
  input: GetMyLanguagePreferenceRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "portal",
    "getMyLanguagePreference",
    input,
  );
export async function getMyLanguagePreference(
  input: GetMyLanguagePreferenceRequest,
): Promise<GetMyLanguagePreferenceResponse> {
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
export const getMyLanguagePreferenceQuery = (
  input: GetMyLanguagePreferenceRequest,
  viewer: Viewer,
) =>
  queryOptions<GetMyLanguagePreferenceResponse, PortalProblem>({
    queryKey: getMyLanguagePreferenceKey(input, viewer),
    queryFn: () => getMyLanguagePreference(input),
  });
