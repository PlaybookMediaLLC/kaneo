import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills-public"][":workspace"]["hc"]["search"].$post;
export type SearchPublicHelpCenterRequest = InferRequestType<typeof endpoint>;
export type SearchPublicHelpCenterResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const searchPublicHelpCenterKey = (
  input: SearchPublicHelpCenterRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "help-center",
    "searchPublicHelpCenter",
    input,
  );
export async function searchPublicHelpCenter(
  input: SearchPublicHelpCenterRequest,
): Promise<SearchPublicHelpCenterResponse> {
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
export const searchPublicHelpCenterQuery = (
  input: SearchPublicHelpCenterRequest,
  viewer: Viewer,
) =>
  queryOptions<SearchPublicHelpCenterResponse, PortalProblem>({
    queryKey: searchPublicHelpCenterKey(input, viewer),
    queryFn: () => searchPublicHelpCenter(input),
  });
