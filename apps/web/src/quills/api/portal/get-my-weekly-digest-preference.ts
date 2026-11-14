import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["user"]["weekly-digest"].$get;
export type GetMyWeeklyDigestPreferenceRequest = InferRequestType<
  typeof endpoint
>;
export type GetMyWeeklyDigestPreferenceResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getMyWeeklyDigestPreferenceKey = (
  input: GetMyWeeklyDigestPreferenceRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "portal",
    "getMyWeeklyDigestPreference",
    input,
  );
export async function getMyWeeklyDigestPreference(
  input: GetMyWeeklyDigestPreferenceRequest,
): Promise<GetMyWeeklyDigestPreferenceResponse> {
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
export const getMyWeeklyDigestPreferenceQuery = (
  input: GetMyWeeklyDigestPreferenceRequest,
  viewer: Viewer,
) =>
  queryOptions<GetMyWeeklyDigestPreferenceResponse, PortalProblem>({
    queryKey: getMyWeeklyDigestPreferenceKey(input, viewer),
    queryFn: () => getMyWeeklyDigestPreference(input),
  });
