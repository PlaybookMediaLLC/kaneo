import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["post-draft"]["improve"]
    .$post;
export type ImprovePortalPostDraftRequest = InferRequestType<typeof endpoint>;
export type ImprovePortalPostDraftResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const improvePortalPostDraftKey = (
  input: ImprovePortalPostDraftRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "improvePortalPostDraft",
    input,
  );
export async function improvePortalPostDraft(
  input: ImprovePortalPostDraftRequest,
): Promise<ImprovePortalPostDraftResponse> {
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
export const improvePortalPostDraftQuery = (
  input: ImprovePortalPostDraftRequest,
  viewer: Viewer,
) =>
  queryOptions<ImprovePortalPostDraftResponse, PortalProblem>({
    queryKey: improvePortalPostDraftKey(input, viewer),
    queryFn: () => improvePortalPostDraft(input),
  });
