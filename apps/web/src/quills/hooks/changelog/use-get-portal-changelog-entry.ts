import { useQuery } from "@tanstack/react-query";
import type { Viewer } from "../../core/types";
import {
  getPortalChangelogEntryQuery,
  type GetPortalChangelogEntryRequest,
} from "../../api/changelog/get-portal-changelog-entry";
export function useGetPortalChangelogEntry(
  input: GetPortalChangelogEntryRequest,
  viewer: Viewer,
) {
  return useQuery({
    ...getPortalChangelogEntryQuery(input, viewer),
    enabled: Boolean(input.param.workspace && input.param.entryId),
  });
}
