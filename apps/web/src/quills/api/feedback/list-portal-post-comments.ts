import type { InferRequestType, InferResponseType } from "hono/client";
import { infiniteQueryOptions, type InfiniteData } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["posts"][":postId"][
    "comments"
  ].$get;
export type ListPortalPostCommentsRequest = InferRequestType<typeof endpoint>;
export type ListPortalPostCommentsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listPortalPostCommentsKey = (
  input: ListPortalPostCommentsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "listPortalPostComments",
    input,
  );
export async function listPortalPostComments(
  input: ListPortalPostCommentsRequest,
): Promise<ListPortalPostCommentsResponse> {
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
export const listPortalPostCommentsQuery = (
  input: ListPortalPostCommentsRequest,
  viewer: Viewer,
) =>
  infiniteQueryOptions<
    ListPortalPostCommentsResponse,
    PortalProblem,
    InfiniteData<ListPortalPostCommentsResponse>,
    ReturnType<typeof listPortalPostCommentsKey>,
    number
  >({
    queryKey: listPortalPostCommentsKey(input, viewer),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listPortalPostComments({
        ...input,
        query: { ...input.query, offset: String(pageParam) },
      }),
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });
