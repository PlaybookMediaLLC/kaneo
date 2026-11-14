import type { InferRequestType, InferResponseType } from "hono/client";
import {
  infiniteQueryOptions,
  queryOptions,
  type InfiniteData,
} from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["tickets"].$get;
export type ListTicketsRequest = InferRequestType<typeof endpoint>;
export type ListTicketsResponse = InferResponseType<typeof endpoint, 200>;
export const listTicketsKey = (input: ListTicketsRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "listTickets", input);
export async function listTickets(
  input: ListTicketsRequest,
): Promise<ListTicketsResponse> {
  try {
    const response = await endpoint(input);
    if (!response.ok) throw await toPortalProblem(response, "teammate", false);
    return response.json();
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error)
      throw error;
    throw networkPortalProblem();
  }
}
export const listTicketsQuery = (input: ListTicketsRequest, viewer: Viewer) =>
  queryOptions<ListTicketsResponse, PortalProblem>({
    queryKey: listTicketsKey(input, viewer),
    queryFn: () => listTickets(input),
  });
export const listTicketsInfiniteQuery = (
  input: ListTicketsRequest,
  viewer: Viewer,
) =>
  infiniteQueryOptions<
    ListTicketsResponse,
    PortalProblem,
    InfiniteData<ListTicketsResponse>,
    ReturnType<typeof listTicketsKey>,
    string | undefined
  >({
    queryKey: listTicketsKey(input, viewer),
    initialPageParam: undefined,
    queryFn: ({ pageParam }) =>
      listTickets({ ...input, query: { ...input.query, cursor: pageParam } }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
