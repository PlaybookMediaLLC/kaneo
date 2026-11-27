import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  rejectPost,
  type RejectPostRequest,
  type RejectPostResponse,
} from "../../api/team/reject-post";
export function useRejectPost(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<RejectPostResponse, PortalProblem, RejectPostRequest>({
    mutationFn: (input) => rejectPost(input),
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
      ]);
    },
  });
}
