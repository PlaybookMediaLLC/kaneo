import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  createPostTask,
  type CreatePostTaskRequest,
  type CreatePostTaskResponse,
} from "../../api/team/create-post-task";
export function useCreatePostTask(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    CreatePostTaskResponse,
    PortalProblem,
    CreatePostTaskRequest
  >({
    mutationFn: (input) => createPostTask(input),
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
