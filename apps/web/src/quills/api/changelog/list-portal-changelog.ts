import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["changelog"].$get;
export type ListPortalChangelogRequest = InferRequestType<typeof endpoint>;
export type ListPortalChangelogResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listPortalChangelogKey = (
  input: ListPortalChangelogRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "changelog",
    "listPortalChangelog",
    input,
  );
export async function listPortalChangelog(
  input: ListPortalChangelogRequest,
): Promise<ListPortalChangelogResponse> {
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
export const listPortalChangelogQuery = (
  input: ListPortalChangelogRequest,
  viewer: Viewer,
) =>
  queryOptions<ListPortalChangelogResponse, PortalProblem>({
    queryKey: listPortalChangelogKey(input, viewer),
    queryFn: () => listPortalChangelog(input),
  });
