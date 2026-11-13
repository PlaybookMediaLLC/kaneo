import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getPortalFileQuery,
  type GetPortalFileRequest,
} from "../../api/files/get-portal-file";
export function useGetPortalFile(input: GetPortalFileRequest, viewer: Viewer) {
  return useQuery({
    ...getPortalFileQuery(input, viewer),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    enabled: Boolean(input.param.workspace && input.param.fileId),
  });
}
