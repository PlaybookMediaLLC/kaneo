import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PortalProblem, Viewer } from "../../core/types";
import { quillsOperationKey } from "../../api/keys";
import {
  updateCustomerProfile,
  type UpdateCustomerProfileRequest,
  type UpdateCustomerProfileResponse,
} from "../../api/portal/update-customer-profile";
export function useUpdateCustomerProfile(viewer: Viewer) {
  const queryClient = useQueryClient();
  return useMutation<
    UpdateCustomerProfileResponse,
    PortalProblem,
    UpdateCustomerProfileRequest
  >({
    mutationFn: (input) => updateCustomerProfile(input),
    onSuccess: async (_data, input) => {
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "portal",
          "getCustomerProfile",
        ),
      });
      await queryClient.invalidateQueries({
        queryKey: quillsOperationKey(
          input.param.workspace,
          viewer,
          "portal",
          "getPublicUserProfile",
        ),
      });
    },
  });
}
