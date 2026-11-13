import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills-public"][":workspace"]["portal"]["roadmaps"].$get;
export type ListPortalRoadmapsRequest = InferRequestType<typeof endpoint>;
export type ListPortalRoadmapsResponse = InferResponseType<
  typeof endpoint,
  200
>;
export const listPortalRoadmapsKey = (
  input: ListPortalRoadmapsRequest,
  viewer: Viewer,
) =>
  quillsKey(
    input.param.workspace,
    viewer,
    "feedback",
    "listPortalRoadmaps",
    input,
  );
export async function listPortalRoadmaps(
  input: ListPortalRoadmapsRequest,
): Promise<ListPortalRoadmapsResponse> {
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
export const listPortalRoadmapsQuery = (
  input: ListPortalRoadmapsRequest,
  viewer: Viewer,
) =>
  queryOptions<ListPortalRoadmapsResponse, PortalProblem>({
    queryKey: listPortalRoadmapsKey(input, viewer),
    queryFn: () => listPortalRoadmaps(input),
  });
