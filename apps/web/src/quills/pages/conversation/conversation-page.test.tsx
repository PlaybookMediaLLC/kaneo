import { act } from "@testing-library/react";
import { focusManager } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vite-plus/test";
import { getMyConversationFixture } from "../../api/support/get-my-conversation.fixture";
import { listMyConversationMessagesFixture } from "../../api/support/list-my-conversation-messages.fixture";
import { markMyConversationReadFixture } from "../../api/support/mark-my-conversation-read.fixture";
import { sendMyConversationMessageFixture } from "../../api/support/send-my-conversation-message.fixture";
import { fill, press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { ConversationPage } from "./conversation-page";
describe("ConversationPage", () => {
  const options = {
    viewer: { kind: "user" as const, id: "account_test_1" },
    params: { conversationId: "conversation_test_1" },
  };
  const prepareConversation = () => {
    const api = mockApi();
    api.reply(
      getMyConversationFixture.ok({
        conversation: {
          ...getMyConversationFixture.ok().conversation,
          id: "conversation_test_1",
          subject: "Billing question",
        },
      }),
    );
    api.reply(listMyConversationMessagesFixture.ok());
    return api;
  };
  describePageContract(meta, ConversationPage, {
    loading: {
      prepare: () => {
        mockApi().defer(() => undefined);
        return options;
      },
    },
    failed: {
      prepare: () => {
        mockApi().fail();
        return options;
      },
    },
    ready: {
      prepare: () => {
        prepareConversation();
        return options;
      },
      assert: async (view) => {
        await view.findByText("Billing question");
      },
    },
    done: {
      prepare: () => {
        const api = prepareConversation();
        api.reply(sendMyConversationMessageFixture.ok());
        api.reply(getMyConversationFixture.ok());
        api.reply(listMyConversationMessagesFixture.ok());
        return options;
      },
      act: async (view) => {
        await view.findByText("Billing question");
        fill(/reply/i, "Thank you");
        press(/send reply/i);
      },
      assert: async (view) => {
        await vi.waitFor(() =>
          expect(view.getByRole("textbox", { name: /reply/i })).toHaveValue(""),
        );
      },
    },
  });

  describe("behavior", () => {
    it("loads older messages in reading order and stops at the beginning", async () => {
      const api = mockApi();
      const message = (id: string, content: string) => ({
        id,
        content,
        conversationId: "conversation_test_1",
        fromVisitor: false,
        senderType: "agent" as const,
        author: { name: "Support", avatarUrl: null },
        embeds: [],
        attachments: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        editedAt: null,
      });
      api.reply(getMyConversationFixture.ok());
      api.reply(
        listMyConversationMessagesFixture.ok({
          items: [message("message_new", "Recent reply")],
          hasMore: true,
        }),
      );
      api.reply(
        listMyConversationMessagesFixture.ok({
          items: [message("message_old", "Original question")],
        }),
      );
      const view = renderPage(ConversationPage, meta, options);
      await view.findByText("Recent reply");
      press("Load older messages");
      await view.findByText("Original question");
      expect(
        new URL(
          api.calls("listQuillsMyConversationMessages")[1]!.url,
        ).searchParams.get("before"),
      ).toBe("message_new");
      expect(
        view.queryByRole("button", { name: "Load older messages" }),
      ).not.toBeInTheDocument();
      expect(
        view
          .getByText("Original question")
          .compareDocumentPosition(view.getByText("Recent reply")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("refreshes incoming replies on the visible interval and pauses while hidden", async () => {
      vi.useFakeTimers();
      const api = prepareConversation();
      const view = renderPage(ConversationPage, meta, options);
      await act(() => vi.advanceTimersByTimeAsync(10));
      expect(view.getByText("Billing question")).toBeInTheDocument();
      try {
        focusManager.setFocused(false);
        await act(() => vi.advanceTimersByTimeAsync(10_000));
        expect(api.calls("listQuillsMyConversationMessages")).toHaveLength(1);
        const incoming = listMyConversationMessagesFixture.ok({
          items: [
            {
              id: "message_incoming",
              conversationId: "conversation_test_1",
              fromVisitor: false,
              senderType: "agent",
              author: { name: "Support", avatarUrl: null },
              content: "Incoming team reply",
              embeds: [],
              attachments: [],
              createdAt: "2026-01-01T00:00:00.000Z",
              editedAt: null,
            },
          ],
        });
        vi.spyOn(globalThis, "fetch").mockImplementation(
          async (input) =>
            new Response(
              JSON.stringify(
                new URL(new Request(input).url).pathname.endsWith("/messages")
                  ? incoming
                  : getMyConversationFixture.ok(),
              ),
              { headers: { "content-type": "application/json" } },
            ),
        );
        focusManager.setFocused(true);
        await act(() => vi.advanceTimersByTimeAsync(10_010));
        expect(view.getByText("Incoming team reply")).toBeInTheDocument();
      } finally {
        view.unmount();
        vi.restoreAllMocks();
        focusManager.setFocused(undefined);
        vi.useRealTimers();
      }
    });
    it("marks the newest message read once and sends a reply", async () => {
      const api = mockApi();
      const conversation = getMyConversationFixture.ok({
        conversation: {
          ...getMyConversationFixture.ok().conversation,
          id: "conversation_test_1",
          subject: "Billing question",
          unreadCount: 1,
        },
      });
      const messages = listMyConversationMessagesFixture.ok({
        items: [
          {
            id: "conversation_msg_test_1",
            conversationId: "conversation_test_1",
            fromVisitor: false,
            senderType: "agent",
            author: { name: "Support", avatarUrl: null },
            content: "We found the invoice",
            embeds: [],
            attachments: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            editedAt: null,
          },
        ],
      });
      api.reply(conversation);
      api.reply(messages);
      api.reply(
        markMyConversationReadFixture.ok({ unreadCount: 0, changed: true }),
      );
      api.reply(conversation);
      const view = renderPage(ConversationPage, meta, {
        viewer: { kind: "user", id: "account_test_1" },
        params: { conversationId: "conversation_test_1" },
      });

      await view.findByText("We found the invoice");
      await vi.waitFor(() =>
        expect(api.calls("markQuillsMyConversationRead")).toHaveLength(1),
      );
      api.reply(sendMyConversationMessageFixture.ok());
      api.reply(
        getMyConversationFixture.ok({
          conversation: { ...conversation.conversation, unreadCount: 0 },
        }),
      );
      api.reply(messages);
      fill(/reply/i, "Thank you");
      press(/send reply/i);
      await vi.waitFor(() =>
        expect(api.calls("sendQuillsMyConversationMessage")).toHaveLength(1),
      );
      await vi.waitFor(() =>
        expect(view.getByRole("textbox", { name: /reply/i })).toHaveValue(""),
      );
      expect(api.calls("markQuillsMyConversationRead")).toHaveLength(1);
    });

    it("requires sign-in without fetching the conversation", async () => {
      const api = mockApi();
      const view = renderPage(ConversationPage, meta, {
        params: { conversationId: "conversation_test_1" },
      });
      expect(
        await view.findByRole("link", { name: /sign in/i }),
      ).toBeInTheDocument();
      expect(api.calls()).toHaveLength(0);
    });
  });
});
