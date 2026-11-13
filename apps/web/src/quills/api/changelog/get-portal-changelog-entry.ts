import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["changelog"][":entryId"].$get;
export type GetPortalChangelogEntryRequest = InferRequestType<typeof endpoint>;
export type GetPortalChangelogEntryResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const getPortalChangelogEntryKey = (
  input: GetPortalChangelogEntryRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "changelog",
    "getPortalChangelogEntry",
    input,
  );
export async function getPortalChangelogEntry(
  input: GetPortalChangelogEntryRequest,
): Promise<GetPortalChangelogEntryResponse> {
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
export const getPortalChangelogEntryQuery = (
  input: GetPortalChangelogEntryRequest,
  viewer: Viewer,
) =>
  queryOptions<GetPortalChangelogEntryResponse, PortalProblem>({
    queryKey: getPortalChangelogEntryKey(input, viewer),
    queryFn: () => getPortalChangelogEntry(input),
  });
