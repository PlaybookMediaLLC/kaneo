import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  listPrincipalsQuery,
  type ListPrincipalsRequest,
} from "../../api/team/list-principals";
export function useListPrincipals(
  input: ListPrincipalsRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...listPrincipalsQuery(input, viewer),
    enabled: Boolean(input.param.workspaceId),
  });
}
