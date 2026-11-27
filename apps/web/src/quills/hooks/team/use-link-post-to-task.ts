import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  linkPostToTask,
  type LinkPostToTaskRequest,
  type LinkPostToTaskResponse,
} from "../../api/team/link-post-to-task";
export function useLinkPostToTask(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    LinkPostToTaskResponse,
    PortalProblem,
    LinkPostToTaskRequest
  >({
    mutationFn: (input) => linkPostToTask(input),
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
