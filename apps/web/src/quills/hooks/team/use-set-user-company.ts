import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  setUserCompany,
  type SetUserCompanyRequest,
  type SetUserCompanyResponse,
} from "../../api/team/set-user-company";
export function useSetUserCompany(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SetUserCompanyResponse,
    PortalProblem,
    SetUserCompanyRequest
  >({
    mutationFn: (input) => setUserCompany(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getUser",
          ),
        }),
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
            "listUsers",
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
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getProfileTeamContext",
          ),
        }),
      ]);
    },
  });
}
