import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  unsubscribeMyChangelog,
  type UnsubscribeMyChangelogRequest,
  type UnsubscribeMyChangelogResponse,
} from "../../api/portal/unsubscribe-my-changelog";
export function useUnsubscribeMyChangelog(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    UnsubscribeMyChangelogResponse,
    PortalProblem,
    UnsubscribeMyChangelogRequest
  >({
    mutationFn: (input) => unsubscribeMyChangelog(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "portal",
          "getMyChangelogSubscription",
        ),
      });
    },
  });
}
