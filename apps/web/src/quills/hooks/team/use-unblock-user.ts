import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  unblockUser,
  type UnblockUserRequest,
  type UnblockUserResponse,
} from "../../api/team/unblock-user";
export function useUnblockUser(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<UnblockUserResponse, PortalProblem, UnblockUserRequest>({
    mutationFn: (input) => unblockUser(input),
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
