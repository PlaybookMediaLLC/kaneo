import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listSurveysQuery,
  type ListSurveysRequest,
} from "../../api/team/list-surveys";
export function useListSurveys(input: ListSurveysRequest, viewer: Viewer) {
  return useQuery({
    ...listSurveysQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
