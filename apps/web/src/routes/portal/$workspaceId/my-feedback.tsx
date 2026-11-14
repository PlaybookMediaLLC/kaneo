import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { MyFeedbackPage } from "@/quills/pages/my-feedback/my-feedback-page";
import { listPortalMyFeedbackInfiniteQuery } from "@/quills/api/feedback/list-portal-my-feedback";
import { getMyWeeklyDigestPreferenceQuery } from "@/quills/api/portal/get-my-weekly-digest-preference";
const searchSchema = z.object({});
export const Route = createFileRoute("/portal/$workspaceId/my-feedback")({
  validateSearch: searchSchema,
  beforeLoad: async ({ context, params, search }) => {
    void search;
    if (
      !(
        context.quillsPortal.accessGranted &&
        context.quillsPortal.viewer.kind === "user"
      )
    )
      return;
    await Promise.all([
      context.queryClient.prefetchInfiniteQuery(
        listPortalMyFeedbackInfiniteQuery(
          {
            param: { workspace: params.workspaceId },
            query: { filter: "all", offset: "0", limit: "20" },
          },
          context.quillsPortal.viewer,
        ),
      ),
      context.queryClient.prefetchQuery(
        getMyWeeklyDigestPreferenceQuery(
          { param: { workspace: params.workspaceId } },
          context.quillsPortal.viewer,
        ),
      ),
    ]);
  },
  component: RouteComponent,
});
function RouteComponent() {
  const params = Route.useParams();
  return (
    <MyFeedbackPage
      workspaceId={"workspaceId" in params ? String(params.workspaceId) : ""}
      params={params}
      search={Route.useSearch()}
    />
  );
}
