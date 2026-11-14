import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { getConversationFixture } from "../../api/team/get-conversation.fixture";
import { getConversationTicketLinkFixture } from "../../api/team/get-conversation-ticket-link.fixture";
import { getConversationTypingFixture } from "../../api/team/get-conversation-typing.fixture";
import { getLinkedPostsForConversationFixture } from "../../api/team/get-linked-posts-for-conversation.fixture";
import { getUserFixture } from "../../api/team/get-user.fixture";
import { listConversationAttributesFixture } from "../../api/team/list-conversation-attributes.fixture";
import { listConversationMessagesFixture } from "../../api/team/list-conversation-messages.fixture";
import { listConversationTagsFixture } from "../../api/team/list-conversation-tags.fixture";
import { listConversationViewsFixture } from "../../api/team/list-conversation-views.fixture";
import { listConversationsFixture } from "../../api/team/list-conversations.fixture";
import { listPrincipalsFixture } from "../../api/team/list-principals.fixture";
import { listTeamsFixture } from "../../api/team/list-teams.fixture";
import { markConversationReadFixture } from "../../api/team/mark-conversation-read.fixture";
import { replyConversationFixture } from "../../api/team/reply-conversation.fixture";
import { sendConversationTypingFixture } from "../../api/team/send-conversation-typing.fixture";
import { describePageContract } from "../../test/contracts";
import { press } from "../../test/actions";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { ShortcutListener } from "../../ui/upstream";
import { meta } from "./meta";
import {
  TeamConversationPage,
  type TeamConversationPageProps,
} from "./team-conversation-page";

type Api = ReturnType<typeof mockApi>;
const conversation = getConversationFixture.ok({
  id: "conversation_test_1",
  subject: "Export fails",
  visitorName: "Grace",
});
const row = (id: string) => ({ ...conversation, id, subject: id });
const reads = (overrides: Record<string, unknown> = {}) => ({
  getQuillsConversation: conversation,
  listQuillsConversationMessages: listConversationMessagesFixture.ok(),
  listQuillsConversations: listConversationsFixture.ok({
    items: [
      row("conversation_test_0"),
      conversation,
      row("conversation_test_2"),
    ],
  }),
  listQuillsPrincipals: listPrincipalsFixture.ok(),
  listQuillsConversationViews: listConversationViewsFixture.ok(),
  getQuillsConversationTyping: getConversationTypingFixture.ok(),
  listQuillsConversationTags: listConversationTagsFixture.ok(),
  getQuillsUser: getUserFixture.ok(),
  getQuillsConversationTicketLink: getConversationTicketLinkFixture.ok(),
  getQuillsLinkedPostsForConversation:
    getLinkedPostsForConversationFixture.ok(),
  listQuillsTeams: listTeamsFixture.ok(),
  listQuillsConversationAttributes: listConversationAttributesFixture.ok(),
  markQuillsConversationRead: markConversationReadFixture.ok(),
  replyQuillsConversation: replyConversationFixture.ok(),
  sendQuillsConversationTyping: sendConversationTypingFixture.ok(),
  ...overrides,
});

/**
 * Answers each request by its operation. The panes load in parallel, so their order
 * is not fixed; every request takes the next queued reply and reads its own answer.
 */
function answer(api: Api, answers: Record<string, unknown> = reads()) {
  for (let index = 0; index < 40; index += 1)
    api.defer(({ resolve }) => {
      const request = api.calls().at(-1)!;
      const id = Object.keys(answers).find((operation) =>
        api.calls(operation).includes(request),
      );
      resolve(id ? answers[id] : { message: "Unexpected" }, id ? 200 : 500);
    });
}

function WithKeys(props: TeamConversationPageProps) {
  return (
    <>
      <ShortcutListener />
      <TeamConversationPage {...props} />
    </>
  );
}
const options = {
  params: { conversationId: "conversation_test_1" },
  search: { view: "mine", status: "open" },
};

describe("TeamConversationPage", () => {
  describePageContract(meta, TeamConversationPage, {
    loading: {
      prepare: () => {
        const api = mockApi();
        for (let index = 0; index < 5; index += 1) api.defer(() => undefined);
      },
    },
    failed: {
      prepare: () => {
        const api = mockApi();
        for (let index = 0; index < 5; index += 1) api.fail();
      },
    },
    ready: { prepare: () => answer(mockApi()) },
    done: { prepare: () => answer(mockApi()) },
  });

  describe("behavior", () => {
    it("shows the customer, the thread and the right panel, and reads an unread conversation once", async () => {
      const api = mockApi();
      answer(
        api,
        reads({
          getQuillsConversation: { ...conversation, unreadCount: 2 },
          listQuillsConversationMessages: listConversationMessagesFixture.ok({
            items: [
              {
                id: "message_test_1",
                conversationId: "conversation_test_1",
                senderType: "visitor",
                isInternal: false,
                authorPrincipalId: null,
                authorName: null,
                content: "The export button does nothing.",
                systemKind: null,
                embeds: [],
                attachments: [],
                reactions: [],
                flaggedAt: null,
                createdAt: "2026-11-01T10:00:00.000Z",
                editedAt: null,
              },
            ],
          }),
        }),
      );
      const view = renderPage(TeamConversationPage, meta, options);
      expect(
        await view.findByRole("heading", { level: 1, name: "Grace" }),
      ).toBeInTheDocument();
      expect(
        await view.findByText("The export button does nothing."),
      ).toBeInTheDocument();
      expect(
        view.getByRole("complementary", { name: "Customer and details" }),
      ).toHaveTextContent("Details");
      expect(
        view.getByRole("heading", { level: 2, name: "Mine" }),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(api.calls("markQuillsConversationRead")).toHaveLength(1),
      );
      const messages = new URL(
        api.calls("listQuillsConversationMessages")[0]!.url,
      ).searchParams;
      expect(messages.get("includeInternal")).toBe("true");
    });

    it("moves through the list it came from and goes back to it", async () => {
      answer(mockApi());
      const view = renderPage(WithKeys, meta, options);
      await view.findByRole("link", { name: /conversation_test_2/ });
      fireEvent.keyDown(document.body, { key: "j" });
      await waitFor(() =>
        expect(view.router.state.location.href).toBe(
          "/feedback/workspace_test_1/conversations/conversation_test_2?view=mine&status=open",
        ),
      );
      press("Back to the list");
      await waitFor(() =>
        expect(view.router.state.location.href).toBe(
          "/feedback/workspace_test_1/conversations/mine?status=open",
        ),
      );
    });

    it("replies from the composer that R focuses", async () => {
      const api = mockApi();
      answer(api);
      const view = renderPage(WithKeys, meta, options);
      const box = await view.findByLabelText("Reply to Grace…");
      fireEvent.keyDown(document.body, { key: "r", code: "KeyR" });
      expect(box).toHaveFocus();
      fireEvent.change(box, { target: { value: "Fixed now" } });
      fireEvent.keyDown(box, { key: "Enter" });
      await waitFor(() => expect(box).toHaveValue(""));
      expect(await api.calls("replyQuillsConversation")[0]!.json()).toEqual({
        content: "Fixed now",
      });
    });
  });
});
