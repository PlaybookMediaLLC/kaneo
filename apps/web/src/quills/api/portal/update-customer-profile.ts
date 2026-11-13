import type { InferRequestType, InferResponseType } from "hono/client";
import type { Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills-public"][":workspace"]["user"]["profile"].$put;
export type UpdateCustomerProfileRequest = InferRequestType<typeof endpoint>;
export type UpdateCustomerProfileResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const updateCustomerProfileKey = (
  input: UpdateCustomerProfileRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "portal",
    "updateCustomerProfile",
    input,
  );
export async function updateCustomerProfile(
  input: UpdateCustomerProfileRequest,
): Promise<UpdateCustomerProfileResponse> {
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
