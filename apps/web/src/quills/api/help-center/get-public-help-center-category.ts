import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["hc"]["categories"][":categorySlug"]
    .$get;
export type GetPublicHelpCenterCategoryRequest = InferRequestType<
  typeof endpoint
>;
export type GetPublicHelpCenterCategoryResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getPublicHelpCenterCategoryKey = (
  input: GetPublicHelpCenterCategoryRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "help-center",
    "getPublicHelpCenterCategory",
    input,
  );
export async function getPublicHelpCenterCategory(
  input: GetPublicHelpCenterCategoryRequest,
): Promise<GetPublicHelpCenterCategoryResponse> {
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
export const getPublicHelpCenterCategoryQuery = (
  input: GetPublicHelpCenterCategoryRequest,
  viewer: Viewer,
) =>
  queryOptions<GetPublicHelpCenterCategoryResponse, PortalProblem>({
    queryKey: getPublicHelpCenterCategoryKey(input, viewer),
    queryFn: () => getPublicHelpCenterCategory(input),
  });
