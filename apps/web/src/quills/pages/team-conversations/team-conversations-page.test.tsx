import { fireEvent, waitFor, within } from "@testing-library/react";
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
    priority: "urgent",
    subject: "Export fails",
    visitorName: "Grace",
    assignedAgentPrincipalId: "principal_test_2",
  }),
  row({ id: "conversation_test_2", priority: "low", subject: "Invoice copy" }),
];
const pinned = {
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
function Mine(props: TeamConversationsPageProps) {
  return (
    <>
      <ShortcutListener />
      <TeamConversationsPage
        {...props}
        params={{ ...props.params, view: "mine" }}
      />
    </>
  );
}

describe("TeamConversationsPage", () => {
  describePageContract(meta, TeamConversationsPage, {
    loading: {
      prepare: () => {
        const api = mockApi();
        api.defer(() => undefined);
        api.defer(() => undefined);
        api.defer(() => undefined);
      },
    },
    failed: {
      prepare: () => {
        const api = mockApi();
        api.fail();
        api.fail();
        api.fail();
      },
    },
    ready: {
      prepare: () => {
        const api = mockApi();
        api.reply(listConversationViewsFixture.ok());
        api.reply(listConversationsFixture.ok());
        api.reply(listPrincipalsFixture.ok());
      },
    },
  });

  describe("behavior", () => {
    it("lists my open conversations by priority, and opens the next one by key", async () => {
      const api = mockApi();
      api.reply(listConversationViewsFixture.ok());
      api.reply(listConversationsFixture.ok({ items: rows }));
      api.reply(people);
      const view = renderPage(Mine, meta, { search: { status: "open" } });
      expect(
        await view.findByRole("heading", {
          level: 1,
          name: "My conversations",
        }),
      ).toBeInTheDocument();
      const urgent = await view.findByRole("group", { name: /^Urgent/ });
      expect(within(urgent).getByText("Export fails")).toBeInTheDocument();
      expect(within(urgent).getByText("Assigned to Ada")).toBeInTheDocument();
      expect(view.getByRole("group", { name: /^Low/ })).toHaveTextContent(
        "Invoice copy",
      );
      const query = new URL(api.calls("listQuillsConversations")[0]!.url)
        .searchParams;
      expect(Object.fromEntries(query)).toEqual({
        assignee: "mine",
        status: "open",
        sort: "priority",
        limit: "50",
      });
      fireEvent.keyDown(document.body, { key: "j" });
      fireEvent.keyDown(document.body, { key: "j" });
      fireEvent.keyDown(document.body, { key: "Enter" });
      await waitFor(() =>
        expect(view.router.state.location.href).toBe(
          "/feedback/workspace_test_1/conversations/conversation_test_2?view=mine&status=open",
        ),
      );
    });

    it("filters by a status tab and by a pinned view, and keeps the choice in the address", async () => {
      const api = mockApi();
      api.reply(
        listConversationViewsFixture.ok({
          items: [
            pinned,
            { ...pinned, id: "view_test_2", name: "Hidden", isPinned: false },
          ],
        }),
      );
      api.reply(listConversationsFixture.ok());
      api.reply(people);
      api.reply(listConversationsFixture.ok({ items: rows }));
      api.reply(listConversationsFixture.ok());
      const view = renderPage(Mine, meta);
      await view.findByRole("tab", { name: "Waiting billing" });
      expect(
        view.queryByRole("tab", { name: "Hidden" }),
      ).not.toBeInTheDocument();
      fireEvent.click(view.getByRole("tab", { name: "Snoozed" }));
      expect(await view.findByText("Export fails")).toBeInTheDocument();
      fireEvent.click(view.getByRole("tab", { name: "Waiting billing" }));
      await waitFor(() =>
        expect(api.calls("listQuillsConversations")).toHaveLength(3),
      );
      const [, snoozed, saved] = api
        .calls("listQuillsConversations")
        .map((call) => Object.fromEntries(new URL(call.url).searchParams));
      expect(snoozed).toMatchObject({ status: "snoozed", assignee: "mine" });
      expect(saved).toEqual({
        assignee: "mine",
        waitingOnly: "true",
        sort: "priority",
        limit: "50",
      });
      await waitFor(() =>
        expect(view.router.state.location.search).toEqual({
          status: "snoozed",
          savedView: "view_test_1",
        }),
      );
    });

    it("waits for a pinned view in the address before it loads the list", async () => {
      const api = mockApi();
      api.reply(listConversationViewsFixture.ok({ items: [pinned] }));
      api.reply(people);
      api.reply(listConversationsFixture.ok());
      const view = renderPage(Mine, meta, {
        search: { savedView: "view_test_1" },
      });
      expect(
        await view.findByRole("tab", {
          name: "Waiting billing",
          selected: true,
        }),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(api.calls("listQuillsConversations")).toHaveLength(1),
      );
      expect(
        new URL(api.calls("listQuillsConversations")[0]!.url).searchParams.get(
          "waitingOnly",
        ),
      ).toBe("true");
    });
  });
});
