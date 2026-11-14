import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["hc"]["categories"][":categoryId"][
    "articles"
  ].$get;
export type ListPublicHelpCenterCategoryArticlesRequest = InferRequestType<
  typeof endpoint
>;
export type ListPublicHelpCenterCategoryArticlesResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listPublicHelpCenterCategoryArticlesKey = (
  input: ListPublicHelpCenterCategoryArticlesRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "help-center",
    "listPublicHelpCenterCategoryArticles",
    input,
  );
export async function listPublicHelpCenterCategoryArticles(
  input: ListPublicHelpCenterCategoryArticlesRequest,
): Promise<ListPublicHelpCenterCategoryArticlesResponse> {
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
export const listPublicHelpCenterCategoryArticlesQuery = (
  input: ListPublicHelpCenterCategoryArticlesRequest,
  viewer: Viewer,
) =>
  queryOptions<ListPublicHelpCenterCategoryArticlesResponse, PortalProblem>({
    queryKey: listPublicHelpCenterCategoryArticlesKey(input, viewer),
    queryFn: () => listPublicHelpCenterCategoryArticles(input),
  });
