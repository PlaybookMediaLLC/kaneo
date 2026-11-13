import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills-public"][":workspace"]["hc"]["redirect"].$get;
export type ResolvePublicHelpCenterRedirectRequest = InferRequestType<
  typeof endpoint
>;
export type ResolvePublicHelpCenterRedirectResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const resolvePublicHelpCenterRedirectKey = (
  input: ResolvePublicHelpCenterRedirectRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "help-center",
    "resolvePublicHelpCenterRedirect",
    input,
  );
export async function resolvePublicHelpCenterRedirect(
  input: ResolvePublicHelpCenterRedirectRequest,
): Promise<ResolvePublicHelpCenterRedirectResponse> {
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
export const resolvePublicHelpCenterRedirectQuery = (
  input: ResolvePublicHelpCenterRedirectRequest,
  viewer: Viewer,
) =>
  queryOptions<ResolvePublicHelpCenterRedirectResponse, PortalProblem>({
    queryKey: resolvePublicHelpCenterRedirectKey(input, viewer),
    queryFn: () => resolvePublicHelpCenterRedirect(input),
  });
