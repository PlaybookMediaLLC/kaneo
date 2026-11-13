import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  acceptPortalInvite,
  type AcceptPortalInviteRequest,
  type AcceptPortalInviteResponse,
} from "../../api/portal/accept-portal-invite";
export function useAcceptPortalInvite(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    AcceptPortalInviteResponse,
    PortalProblem,
    AcceptPortalInviteRequest
  >({
    mutationFn: (input) => acceptPortalInvite(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "portal",
          "acceptPortalInvite",
        ),
      });
    },
  });
}
