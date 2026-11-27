import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  approvePost,
  type ApprovePostRequest,
  type ApprovePostResponse,
} from "../../api/team/approve-post";
export function useApprovePost(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<ApprovePostResponse, PortalProblem, ApprovePostRequest>({
    mutationFn: (input) => approvePost(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listPendingModeration",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getModerationStatus",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "getPost",
          ),
        }),
      ]);
    },
  });
}
