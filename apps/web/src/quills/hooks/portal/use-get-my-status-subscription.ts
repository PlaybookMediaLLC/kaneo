import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getMyStatusSubscriptionQuery,
  type GetMyStatusSubscriptionRequest,
} from "../../api/portal/get-my-status-subscription";
export function useGetMyStatusSubscription(
  input: GetMyStatusSubscriptionRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getMyStatusSubscriptionQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
  });
}
