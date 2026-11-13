import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getCustomerProfileQuery,
  type GetCustomerProfileRequest,
} from "../../api/portal/get-customer-profile";
export function useGetCustomerProfile(
  input: GetCustomerProfileRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getCustomerProfileQuery(input, viewer),
    enabled: Boolean(input.param.workspace),
  });
}
