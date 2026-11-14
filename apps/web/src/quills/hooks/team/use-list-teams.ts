import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listTeamsQuery,
  type ListTeamsRequest,
} from "../../api/team/list-teams";
export function useListTeams(input: ListTeamsRequest, viewer: Viewer) {
  return useQuery({
    ...listTeamsQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
