import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getAssistantRunQuery,
  type GetAssistantRunRequest,
} from "../../api/team/get-assistant-run";
export function useGetAssistantRun(
  input: GetAssistantRunRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getAssistantRunQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId && input.param.runId),
  });
}
