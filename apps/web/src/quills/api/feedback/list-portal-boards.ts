import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills-public"][":workspace"]["portal"]["boards"].$get;
export type ListPortalBoardsRequest = InferRequestType<typeof endpoint>;
export type ListPortalBoardsResponse = InferResponseType<typeof endpoint, 200>;
export const listPortalBoardsKey = (
  input: ListPortalBoardsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "listPortalBoards",
    input,
  );
export async function listPortalBoards(
  input: ListPortalBoardsRequest,
): Promise<ListPortalBoardsResponse> {
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
export const listPortalBoardsQuery = (
  input: ListPortalBoardsRequest,
  viewer: Viewer,
) =>
  queryOptions<ListPortalBoardsResponse, PortalProblem>({
    queryKey: listPortalBoardsKey(input, viewer),
    queryFn: () => listPortalBoards(input),
  });
