import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["hc"]["articles"][":idSlug"].$get;
export type GetPublicHelpCenterArticleRequest = InferRequestType<
  typeof endpoint
>;
export type GetPublicHelpCenterArticleResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getPublicHelpCenterArticleKey = (
  input: GetPublicHelpCenterArticleRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "help-center",
    "getPublicHelpCenterArticle",
    input,
  );
export async function getPublicHelpCenterArticle(
  input: GetPublicHelpCenterArticleRequest,
): Promise<GetPublicHelpCenterArticleResponse> {
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
export const getPublicHelpCenterArticleQuery = (
  input: GetPublicHelpCenterArticleRequest,
  viewer: Viewer,
) =>
  queryOptions<GetPublicHelpCenterArticleResponse, PortalProblem>({
    queryKey: getPublicHelpCenterArticleKey(input, viewer),
    queryFn: () => getPublicHelpCenterArticle(input),
  });
