import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  createPostFromTicket,
  type CreatePostFromTicketRequest,
  type CreatePostFromTicketResponse,
} from "../../api/team/create-post-from-ticket";
export function useCreatePostFromTicket(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    CreatePostFromTicketResponse,
    PortalProblem,
    CreatePostFromTicketRequest
  >({
    mutationFn: (input) => createPostFromTicket(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
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
            "getTeamCounts",
          ),
        }),
      ]);
    },
  });
}
