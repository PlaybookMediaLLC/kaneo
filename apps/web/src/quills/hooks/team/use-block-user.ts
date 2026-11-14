import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  blockUser,
  type BlockUserRequest,
  type BlockUserResponse,
} from "../../api/team/block-user";
export function useBlockUser(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<BlockUserResponse, PortalProblem, BlockUserRequest>({
    mutationFn: (input) => blockUser(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspaceId,
          viewer,
          "team",
          "getUser",
        ),
      });
    },
  });
}
