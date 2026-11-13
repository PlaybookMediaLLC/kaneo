import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { clearTokenStash } from "./token-stash";
import { portalHref } from "./portal-href";
import { authClient } from "../ui/upstream";

export function usePortalSignOut(workspaceId: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async () => {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message);
      clearTokenStash();
      queryClient.removeQueries({
        predicate: ({ queryKey }) =>
          queryKey[0] !== "config" && queryKey[0] !== "instance-status",
      });
      queryClient.getMutationCache().clear();
      await navigate({ href: portalHref(workspaceId) });
    },
  });
}
