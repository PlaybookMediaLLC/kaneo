import { describe } from "vite-plus/test";
import { describeHookContract } from "../../test/contracts";
import { getConversationTicketLinkFixture } from "../../api/team/get-conversation-ticket-link.fixture";
import { useGetConversationTicketLink } from "./use-get-conversation-ticket-link";
describe("useGetConversationTicketLink", () => {
  describeHookContract({
    kind: "query",
    hook: useGetConversationTicketLink,
    operationId: "getQuillsConversationTicketLink",
    request: {
      param: {
        workspaceId: "workspace_test_1",
        conversationId: "conversation-id_test_1",
      },
    },
    emptyRequest: {
      param: { workspaceId: "", conversationId: "conversation-id_test_1" },
    },
    response: getConversationTicketLinkFixture.ok(),
    viewer: { kind: "anonymous" },
    takesViewer: false,
    invalidates: [],
  });
});
