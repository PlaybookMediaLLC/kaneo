import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getMyChangelogSubscriptionQuery,
  type GetMyChangelogSubscriptionRequest,
} from "../../api/portal/get-my-changelog-subscription";
export function useGetMyChangelogSubscription(
  input: GetMyChangelogSubscriptionRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getMyChangelogSubscriptionQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
  });
}
