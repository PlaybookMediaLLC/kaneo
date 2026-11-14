import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { getConversationFixture } from "../../api/team/get-conversation.fixture";
import { listConversationViewsFixture } from "../../api/team/list-conversation-views.fixture";
import { listConversationsFixture } from "../../api/team/list-conversations.fixture";
import { listPrincipalsFixture } from "../../api/team/list-principals.fixture";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { ShortcutListener } from "../../ui/upstream";
import type { Conversation } from "./conversation-list";
import { meta } from "./meta";
import {
  TeamConversationsPage,
  type TeamConversationsPageProps,
} from "./team-conversations-page";

const row = (values: Partial<Conversation>): Conversation => ({
  ...getConversationFixture.ok(),
  ...values,
});
const rows = [
  row({
    id: "conversation_test_1",
    subject: "Export fails",
    visitorName: "Grace",
    assignedAgentPrincipalId: "principal_test_2",
  }),
  row({ id: "conversation_test_2", subject: "Invoice copy" }),
];
const saved = {
  id: "view_test_1",
  name: "Waiting billing",
  filters: { rules: [{ field: "waiting", value: true }] },
  sort: null,
  isShared: true,
  isPinned: true,
  createdByPrincipalId: null,
};
const people = listPrincipalsFixture.ok({
  items: [
    {
      id: "principal_test_2",
      userId: "user_test_2",
      name: "Ada",
      avatarUrl: null,
      role: "member",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
});
// The router renders the page with its view; the keys need the shortcut listener.
const inView = (view: string) =>
  function InView(props: TeamConversationsPageProps) {
    return (
      <>
        <ShortcutListener />
        <TeamConversationsPage {...props} params={{ ...props.params, view }} />
      </>
    );
  };
const query = (api: ReturnType<typeof mockApi>, index = 0) =>
  Object.fromEntries(
    new URL(api.calls("listQuillsConversations")[index]!.url).searchParams,
  );
const ready = () => {
  const api = mockApi();
  api.reply(listConversationViewsFixture.ok());
  api.reply(listConversationsFixture.ok());
  api.reply(listPrincipalsFixture.ok());
};

describe("TeamConversationsPage", () => {
  describePageContract(meta, TeamConversationsPage, {
    loading: {
      prepare: () => {
        const api = mockApi();
        for (let index = 0; index < 3; index += 1) api.defer(() => undefined);
      },
    },
    failed: {
      prepare: () => {
        const api = mockApi();
        for (let index = 0; index < 3; index += 1) api.fail();
      },
    },
    ready: { prepare: ready },
    done: { prepare: ready },
  });

  describe("behavior", () => {
    it("lists my open conversations, newest first, and opens the highlighted one by key", async () => {
      const api = mockApi();
      api.reply(listConversationViewsFixture.ok());
      api.reply(listConversationsFixture.ok({ items: rows }));
      api.reply(people);
      const view = renderPage(inView("mine"), meta, {
        search: { status: "open", q: "export" },
      });
      expect(
        await view.findByRole("heading", { level: 1, name: "Mine" }),
      ).toBeInTheDocument();
      expect(await view.findByText("Export fails")).toBeInTheDocument();
      expect(view.getByText("Assigned to Ada")).toBeInTheDocument();
      expect(view.getByText("Select a conversation")).toBeInTheDocument();
      expect(query(api)).toEqual({
        assignee: "mine",
        status: "open",
        sort: "recent",
        limit: "50",
        search: "export",
      });
      fireEvent.keyDown(document.body, { key: "j" });
      fireEvent.keyDown(document.body, { key: "j" });
      fireEvent.keyDown(document.body, { key: "Enter" });
      await waitFor(() =>
        expect(view.router.state.location.href).toBe(
          "/feedback/workspace_test_1/conversations/conversation_test_2?view=mine&status=open&q=export",
        ),
      );
    });

    it("waits for a saved view in the address before it loads the list", async () => {
      const api = mockApi();
      api.reply(listConversationViewsFixture.ok({ items: [saved] }));
      api.reply(people);
      api.reply(listConversationsFixture.ok());
      const view = renderPage(inView("mine"), meta, {
        search: { savedView: "view_test_1" },
      });
      expect(
        await view.findByRole("heading", { level: 1, name: "Waiting billing" }),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(api.calls("listQuillsConversations")).toHaveLength(1),
      );
      expect(query(api)).toEqual({
        assignee: "mine",
        waitingOnly: "true",
        sort: "recent",
        limit: "50",
      });
    });

    it("opens the first conversation of the queue for the Queue pill", async () => {
      const api = mockApi();
      api.reply(listConversationViewsFixture.ok());
      api.reply(listConversationsFixture.ok({ items: rows }));
      api.reply(people);
      const view = renderPage(inView("queue"), meta, {
        search: { status: "open", next: true },
      });
      await waitFor(() =>
        expect(view.router.state.location.href).toBe(
          "/feedback/workspace_test_1/conversations/conversation_test_1?view=queue&status=open",
        ),
      );
      expect(query(api)).toMatchObject({
        sort: "waiting",
        waitingOnly: "true",
      });
    });

    it("shows a new message in the main pane", async () => {
      ready();
      const view = renderPage(inView("all"), meta, { search: { new: true } });
      expect(
        await view.findByRole("heading", { level: 2, name: "New message" }),
      ).toBeInTheDocument();
      expect(view.queryByText("Select a conversation")).not.toBeInTheDocument();
    });
  });
});
