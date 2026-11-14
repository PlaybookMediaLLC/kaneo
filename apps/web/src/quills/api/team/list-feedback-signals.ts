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

const endpoint = client["quills"][":workspaceId"]["feedback-signals"].$get;
export type ListFeedbackSignalsRequest = InferRequestType<typeof endpoint>;
export type ListFeedbackSignalsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listFeedbackSignalsKey = (
  input: ListFeedbackSignalsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspaceId,
    viewer,
    "team",
    "listFeedbackSignals",
    input,
  );
export async function listFeedbackSignals(
  input: ListFeedbackSignalsRequest,
): Promise<ListFeedbackSignalsResponse> {
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
export const listFeedbackSignalsQuery = (
  input: ListFeedbackSignalsRequest,
  viewer: Viewer,
) =>
  queryOptions<ListFeedbackSignalsResponse, PortalProblem>({
    queryKey: listFeedbackSignalsKey(input, viewer),
    queryFn: () => listFeedbackSignals(input),
  });
export const listFeedbackSignalsInfiniteQuery = (
  input: ListFeedbackSignalsRequest,
  viewer: Viewer,
) =>
  infiniteQueryOptions<
    ListFeedbackSignalsResponse,
    PortalProblem,
    InfiniteData<ListFeedbackSignalsResponse>,
    ReturnType<typeof listFeedbackSignalsKey>,
    number
  >({
    queryKey: listFeedbackSignalsKey(input, viewer),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listFeedbackSignals({
        ...input,
        query: { ...input.query, offset: String(pageParam) },
      }),
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });
