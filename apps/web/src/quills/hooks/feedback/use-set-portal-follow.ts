import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  setPortalFollow,
  type SetPortalFollowRequest,
  type SetPortalFollowResponse,
} from "../../api/feedback/set-portal-follow";
export function useSetPortalFollow(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SetPortalFollowResponse,
    PortalProblem,
    SetPortalFollowRequest
  >({
    mutationFn: (input) => setPortalFollow(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "feedback",
          "getPortalPost",
        ),
      });
    },
  });
}
