import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills-public"][":workspace"]["user"]["profile"].$get;
export type GetCustomerProfileRequest = InferRequestType<typeof endpoint>;
export type GetCustomerProfileResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getCustomerProfileKey = (
  input: GetCustomerProfileRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "portal",
    "getCustomerProfile",
    input,
  );
export async function getCustomerProfile(
  input: GetCustomerProfileRequest,
): Promise<GetCustomerProfileResponse> {
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
export const getCustomerProfileQuery = (
  input: GetCustomerProfileRequest,
  viewer: Viewer,
) =>
  queryOptions<GetCustomerProfileResponse, PortalProblem>({
    queryKey: getCustomerProfileKey(input, viewer),
    queryFn: () => getCustomerProfile(input),
  });
