import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills-public"][":workspace"]["user"]["language"].$put;
export type SetMyLanguagePreferenceRequest = InferRequestType<typeof endpoint>;
export type SetMyLanguagePreferenceResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const setMyLanguagePreferenceKey = (
  input: SetMyLanguagePreferenceRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "portal",
    "setMyLanguagePreference",
    input,
  );
export async function setMyLanguagePreference(
  input: SetMyLanguagePreferenceRequest,
): Promise<SetMyLanguagePreferenceResponse> {
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
