import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["user"]["weekly-digest"].$put;
export type SetMyWeeklyDigestPreferenceRequest = InferRequestType<
  typeof endpoint
>;
export type SetMyWeeklyDigestPreferenceResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const setMyWeeklyDigestPreferenceKey = (
  input: SetMyWeeklyDigestPreferenceRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "portal",
    "setMyWeeklyDigestPreference",
    input,
  );
export async function setMyWeeklyDigestPreference(
  input: SetMyWeeklyDigestPreferenceRequest,
): Promise<SetMyWeeklyDigestPreferenceResponse> {
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
