import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["profiles"][":principalId"]
    .$get;
export type GetPublicUserProfileRequest = InferRequestType<typeof endpoint>;
export type GetPublicUserProfileResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getPublicUserProfileKey = (
  input: GetPublicUserProfileRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "portal",
    "getPublicUserProfile",
    input,
  );
export async function getPublicUserProfile(
  input: GetPublicUserProfileRequest,
): Promise<GetPublicUserProfileResponse> {
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
export const getPublicUserProfileQuery = (
  input: GetPublicUserProfileRequest,
  viewer: Viewer,
) =>
  queryOptions<GetPublicUserProfileResponse, PortalProblem>({
    queryKey: getPublicUserProfileKey(input, viewer),
    queryFn: () => getPublicUserProfile(input),
  });
