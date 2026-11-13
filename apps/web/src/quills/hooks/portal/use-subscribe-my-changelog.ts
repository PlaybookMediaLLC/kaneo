import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  subscribeMyChangelog,
  type SubscribeMyChangelogRequest,
  type SubscribeMyChangelogResponse,
} from "../../api/portal/subscribe-my-changelog";
export function useSubscribeMyChangelog(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    SubscribeMyChangelogResponse,
    PortalProblem,
    SubscribeMyChangelogRequest
  >({
    mutationFn: (input) => subscribeMyChangelog(input),
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
