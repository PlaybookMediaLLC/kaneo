import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["status"]["history"].$get;
export type ListPublicStatusHistoryRequest = InferRequestType<typeof endpoint>;
export type ListPublicStatusHistoryResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listPublicStatusHistoryKey = (
  input: ListPublicStatusHistoryRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "status",
    "listPublicStatusHistory",
    input,
  );
export async function listPublicStatusHistory(
  input: ListPublicStatusHistoryRequest,
): Promise<ListPublicStatusHistoryResponse> {
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
export const listPublicStatusHistoryQuery = (
  input: ListPublicStatusHistoryRequest,
  viewer: Viewer,
) =>
  queryOptions<ListPublicStatusHistoryResponse, PortalProblem>({
    queryKey: listPublicStatusHistoryKey(input, viewer),
    queryFn: () => listPublicStatusHistory(input),
  });
