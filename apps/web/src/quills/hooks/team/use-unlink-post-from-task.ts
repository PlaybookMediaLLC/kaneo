import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  unlinkPostFromTask,
  type UnlinkPostFromTaskRequest,
  type UnlinkPostFromTaskResponse,
} from "../../api/team/unlink-post-from-task";
export function useUnlinkPostFromTask(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    UnlinkPostFromTaskResponse,
    PortalProblem,
    UnlinkPostFromTaskRequest
  >({
    mutationFn: (input) => unlinkPostFromTask(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listPostTasks",
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: quillsOperationKey(
            input.param.workspaceId,
            viewer,
            "team",
            "listLinks",
          ),
        }),
      ]);
    },
  });
}
