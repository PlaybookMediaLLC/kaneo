import type { InferRequestType, InferResponseType } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { client } from "../client";
import { networkPortalProblem, toPortalProblem } from "../errors";
import { quillsKey } from "../keys";

const endpoint =
  client["quills"][":workspaceId"]["assistant"]["runs"][":runId"].$get;
export type GetAssistantRunRequest = InferRequestType<typeof endpoint>;
export type GetAssistantRunResponse = InferResponseType<typeof endpoint, 200>;
export const getAssistantRunKey = (
  input: GetAssistantRunRequest,
  viewer: Viewer,
) =>
  quillsKey(input.param.workspaceId, viewer, "team", "getAssistantRun", input);
export async function getAssistantRun(
  input: GetAssistantRunRequest,
): Promise<GetAssistantRunResponse> {
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
export const getAssistantRunQuery = (
  input: GetAssistantRunRequest,
  viewer: Viewer,
) =>
  queryOptions<GetAssistantRunResponse, PortalProblem>({
    queryKey: getAssistantRunKey(input, viewer),
    queryFn: () => getAssistantRun(input),
  });
