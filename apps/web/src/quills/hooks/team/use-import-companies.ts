import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  importCompanies,
  type ImportCompaniesRequest,
  type ImportCompaniesResponse,
} from "../../api/team/import-companies";
export function useImportCompanies(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    ImportCompaniesResponse,
    PortalProblem,
    ImportCompaniesRequest
  >({
    mutationFn: (input) => importCompanies(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getUserCompany",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listPosts",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getPostDemand",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getRevenueAtRisk",
          ),
        }),
      ]);
    },
  });
}
