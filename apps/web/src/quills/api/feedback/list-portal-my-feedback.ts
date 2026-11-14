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

const endpoint =
  client["quills-public"][":workspace"]["portal"]["my-feedback"].$get;
export type ListPortalMyFeedbackRequest = InferRequestType<typeof endpoint>;
export type ListPortalMyFeedbackResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listPortalMyFeedbackKey = (
  input: ListPortalMyFeedbackRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "listPortalMyFeedback",
    input,
  );
export async function listPortalMyFeedback(
  input: ListPortalMyFeedbackRequest,
): Promise<ListPortalMyFeedbackResponse> {
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
export const listPortalMyFeedbackQuery = (
  input: ListPortalMyFeedbackRequest,
  viewer: Viewer,
) =>
  queryOptions<ListPortalMyFeedbackResponse, PortalProblem>({
    queryKey: listPortalMyFeedbackKey(input, viewer),
    queryFn: () => listPortalMyFeedback(input),
  });
export const listPortalMyFeedbackInfiniteQuery = (
  input: ListPortalMyFeedbackRequest,
  viewer: Viewer,
) =>
  infiniteQueryOptions<
    ListPortalMyFeedbackResponse,
    PortalProblem,
    InfiniteData<ListPortalMyFeedbackResponse>,
    ReturnType<typeof listPortalMyFeedbackKey>,
    number
  >({
    queryKey: listPortalMyFeedbackKey(input, viewer),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listPortalMyFeedback({
        ...input,
        query: { ...input.query, offset: String(pageParam) },
      }),
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });
