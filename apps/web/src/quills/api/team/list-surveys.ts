import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint = client["quills"][":workspaceId"]["surveys"].$get;
export type ListSurveysRequest = InferRequestType<typeof endpoint>;
export type ListSurveysResponse = InferResponseType<typeof endpoint, 200>;
export const listSurveysKey = (input: ListSurveysRequest, viewer: Viewer) =>
  quillsKey(input.param.workspaceId, viewer, "team", "listSurveys", input);
export async function listSurveys(
  input: ListSurveysRequest,
): Promise<ListSurveysResponse> {
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
export const listSurveysQuery = (input: ListSurveysRequest, viewer: Viewer) =>
  queryOptions<ListSurveysResponse, PortalProblem>({
    queryKey: listSurveysKey(input, viewer),
    queryFn: () => listSurveys(input),
  });
