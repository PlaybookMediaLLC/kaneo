import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import type { ReactElement } from "react";
import { describe, expect, it } from "vite-plus/test";
import { getConversationTypingFixture } from "../../../api/team/get-conversation-typing.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { MessageList } from "./message-list";

const team = {
  workspaceId: "workspace_test_1",
  viewer: { kind: "user" as const, id: "user_test_1" },
  permissions: {
    read: true,
    create: true,
    update: true,
    delete: true,
    manageSettings: true,
  },
};
// A shared request is a router link, so the list renders inside a router.
const render = (element: ReactElement) =>
  renderComponent(
    <RouterContextProvider
      router={createRouter({
        routeTree: createRootRoute(),
        history: createMemoryHistory(),
      })}
    >
      <TeamRuntimeProvider value={team}>{element}</TeamRuntimeProvider>
    </RouterContextProvider>,
  );
const message = (
  id: string,
  values: Partial<{
    senderType: "visitor" | "agent" | "system";
    isInternal: boolean;
    authorName: string | null;
    content: string;
    systemKind: string | null;
    systemActorPrincipalId: string | null;
    widgetMetadata: Record<string, string> | null;
    createdAt: string;
    embeds: { kind: string; id: string }[];
  }>,
) => ({
  id,
  conversationId: "conversation_test_1",
  senderType: "visitor" as const,
  isInternal: false,
  authorPrincipalId: null,
  authorName: null,
  content: "",
  systemKind: null,
  systemActorPrincipalId: null,
  emailAuth: null,
  widgetMetadata: null,
  embeds: [],
  attachments: [],
  reactions: [],
  flaggedAt: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  editedAt: null,
  redactedAt: null,
  redactedByPrincipalId: null,
  redactedByName: null,
  redactionReason: null,
  sendStatus: "sent" as const,
  scheduledSendAt: null,
  ...values,
});

describe("MessageList", () => {
  it("shows the thread oldest first with day lines, bubbles, notes, events and the typing", async () => {
    const api = mockApi();
    api.reply(getConversationTypingFixture.ok({ visitorTyping: true }));
    const view = render(
      <MessageList
        workspaceId="workspace_test_1"
        conversationId="conversation_test_1"
        customerName="Grace"
        messages={[
          message("m4", {
            senderType: "system",
            systemKind: "chat_ended",
            content: "Conversation ended",
            createdAt: "2026-11-02T09:00:00.000Z",
          }),
          message("m3", {
            senderType: "agent",
            isInternal: true,
            authorName: "Ada",
            content: "Check the invoice",
          }),
          message("m2", {
            senderType: "agent",
            authorName: "Ada",
            content: "On it",
          }),
          message("m1", {
            content: "Export fails",
            widgetMetadata: {
              pageUrl: "https://app.example/export",
              browser: "Firefox 140 on Linux",
            },
          }),
        ]}
        people={[]}
      />,
    );
    const items = view.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Grace");
    expect(items[0]).toHaveTextContent("Export fails");
    // The customer's message shows the page and the browser it came from.
    expect(items[0]).toHaveTextContent("https://app.example/export");
    expect(items[0]).toHaveTextContent("Firefox 140 on Linux");
    expect(items[1]).not.toHaveTextContent("Page");
    // A day line starts the thread and each new day.
    expect(items[0]!.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-11-01T10:00:00.000Z",
    );
    expect(items[1]!.querySelectorAll("time")).toHaveLength(1);
    expect(items[2]).toHaveTextContent("Internal note");
    expect(items[2]).toHaveTextContent("Check the invoice");
    expect(items[3]).toHaveTextContent("Conversation ended");
    expect(items[3]!.querySelectorAll("time")).toHaveLength(2);
    expect(await view.findByText("Grace is typing…")).toBeInTheDocument();
  });

  it("names the teammate who resolved or reopened", () => {
    const api = mockApi();
    api.reply(getConversationTypingFixture.ok());
    const person = (id: string, userId: string, name: string) => ({
      id,
      userId,
      name,
      avatarUrl: null,
      role: "member",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const notice = (
      id: string,
      systemKind: string,
      systemActorPrincipalId: string | null,
    ) =>
      message(id, {
        senderType: "system",
        systemKind,
        systemActorPrincipalId,
        content: "Stored text",
      });
    const view = render(
      <MessageList
        workspaceId="workspace_test_1"
        conversationId="conversation_test_1"
        customerName="Grace"
        messages={[
          notice("m4", "chat_ended", null),
          notice("m3", "chat_reopened", "principal_test_9"),
          notice("m2", "chat_reopened", "principal_test_2"),
          notice("m1", "chat_ended", "principal_test_1"),
        ]}
        people={[
          person("principal_test_1", "user_test_1", "Ada"),
          person("principal_test_2", "user_test_2", "Lin"),
        ]}
      />,
    );
    const items = view.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("You resolved this conversation");
    expect(items[1]).toHaveTextContent("Lin reopened this conversation");
    // An unknown teammate and a notice without an actor keep the stored text.
    expect(items[2]).toHaveTextContent("Stored text");
    expect(items[3]).toHaveTextContent("Stored text");
  });

  it("says when the thread is empty", () => {
    const api = mockApi();
    api.reply(getConversationTypingFixture.ok());
    const view = render(
      <MessageList
        workspaceId="workspace_test_1"
        conversationId="conversation_test_1"
        customerName="Grace"
        messages={[]}
        people={[]}
      />,
    );
    expect(view.getByText("No messages yet.")).toBeInTheDocument();
  });

  it("links a request that a teammate shared into the thread", async () => {
    const api = mockApi();
    api.reply(getConversationTypingFixture.ok());
    const view = render(
      <MessageList
        workspaceId="workspace_test_1"
        conversationId="conversation_test_1"
        customerName="Grace"
        messages={[
          message("m1", {
            senderType: "agent",
            authorName: "Ada",
            embeds: [{ kind: "post", id: "post_test_1" }],
          }),
        ]}
        people={[]}
      />,
    );
    expect(
      await view.findByRole("link", { name: "Shared a request" }),
    ).toHaveAttribute("href", "/feedback/workspace_test_1/posts/post_test_1");
  });
});
