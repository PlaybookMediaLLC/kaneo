import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ConversationPage } from "@/quills/pages/conversation/conversation-page";
import { getMyConversationQuery } from "@/quills/api/support/get-my-conversation";
import { listMyConversationMessagesQuery } from "@/quills/api/support/list-my-conversation-messages";

const searchSchema = z.object({});
export const Route = createFileRoute(
  "/portal/$workspaceId/conversations/$conversationId",
)({
  validateSearch: searchSchema,
  beforeLoad: async ({ context, params }) => {
    if (
      !context.quillsPortal.accessGranted ||
      context.quillsPortal.viewer.kind !== "user"
    )
      return;
    const input = {
      param: {
        workspace: params.workspaceId,
        conversationId: params.conversationId,
      },
    };
    await Promise.all([
      context.queryClient.prefetchQuery(
        getMyConversationQuery(input, context.quillsPortal.viewer),
      ),
      context.queryClient.prefetchInfiniteQuery(
        listMyConversationMessagesQuery(
          { ...input, query: { limit: "100" } },
          context.quillsPortal.viewer,
        ),
      ),
    ]);
  },
  component: RouteComponent,
});
function RouteComponent() {
  return (
    <ConversationPage
      workspaceId={Route.useParams().workspaceId}
      params={Route.useParams()}
      search={Route.useSearch()}
    />
  );
}
