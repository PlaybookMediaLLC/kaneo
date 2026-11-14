import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";
import { assignConversationTeamFixture } from "../../../api/team/assign-conversation-team.fixture";
import { getConversationFixture } from "../../../api/team/get-conversation.fixture";
import { getConversationTicketLinkFixture } from "../../../api/team/get-conversation-ticket-link.fixture";
import { getLinkedPostsForConversationFixture } from "../../../api/team/get-linked-posts-for-conversation.fixture";
import { getUserFixture } from "../../../api/team/get-user.fixture";
import { listConversationAttributesFixture } from "../../../api/team/list-conversation-attributes.fixture";
import { listConversationTagsFixture } from "../../../api/team/list-conversation-tags.fixture";
import { listTeamsFixture } from "../../../api/team/list-teams.fixture";
import { setConversationPriorityFixture } from "../../../api/team/set-conversation-priority.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { choose } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { ConversationProperties } from "./conversation-properties";

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
const conversation = getConversationFixture.ok({
  id: "conversation_test_1",
  status: "snoozed",
  priority: "high",
  assignedAgentPrincipalId: "principal_test_2",
  attributes: [
    { key: "plan", value: "pro", source: null, at: null },
    { key: "seats", value: ["a", "b"], source: null, at: null },
    { key: "empty", value: null, source: null, at: null },
  ],
});
const attribute = {
  id: "attribute_test_1",
  key: "plan",
  label: "Plan tier",
  description: null,
  fieldType: "text" as const,
  options: null,
  requiredToClose: false,
  sourceHint: null,
  aiDetect: false,
  detectOnClose: false,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** Answers each read by its operation: the panel and its parts load in parallel. */
function answerReads(api: ReturnType<typeof mockApi>) {
  const answers: Record<string, unknown> = {
    listQuillsConversationTags: listConversationTagsFixture.ok(),
    getQuillsUser: getUserFixture.ok({ name: "Grace Customer" }),
    getQuillsConversationTicketLink: getConversationTicketLinkFixture.ok(),
    getQuillsLinkedPostsForConversation:
      getLinkedPostsForConversationFixture.ok(),
    listQuillsTeams: listTeamsFixture.ok({
      teams: [
        {
          id: "team_test_1",
          name: "Billing",
          kaneoTeamId: null,
          isDefault: false,
          icon: null,
          color: null,
          description: null,
          assignmentMethod: "manual",
        },
      ],
    }),
    listQuillsConversationAttributes: listConversationAttributesFixture.ok({
      items: [attribute],
    }),
  };
  for (const _read of Object.keys(answers))
    api.defer(({ resolve }) => {
      const request = api.calls().at(-1)!;
      const id = Object.keys(answers).find((operation) =>
        api.calls(operation).includes(request),
      );
      resolve(id ? answers[id] : { message: "Unexpected" }, id ? 200 : 500);
    });
}

const render = () =>
  renderComponent(
    <RouterContextProvider
      router={createRouter({
        routeTree: createRootRoute(),
        history: createMemoryHistory(),
      })}
    >
      <TeamRuntimeProvider value={team}>
        <ConversationProperties
          workspaceId="workspace_test_1"
          conversation={conversation}
        />
      </TeamRuntimeProvider>
    </RouterContextProvider>,
  );

describe("ConversationProperties", () => {
  it("shows the customer, then the attributes with their labels", async () => {
    const api = mockApi();
    answerReads(api);
    const view = render();
    expect(await view.findByText("Plan tier")).toBeInTheDocument();
    expect(view.getByText("pro")).toBeInTheDocument();
    expect(view.getByText("a, b")).toBeInTheDocument();
    expect(view.queryByText("empty")).not.toBeInTheDocument();
    expect(
      await view.findByRole("heading", { level: 2, name: "Grace Customer" }),
    ).toBeInTheDocument();
    expect(
      view.getByRole("heading", { level: 2, name: "Details" }),
    ).toBeVisible();
    expect(view.getByRole("combobox", { name: "Priority" })).toHaveTextContent(
      "High",
    );
  });

  it("changes the team and the priority", async () => {
    const api = mockApi();
    answerReads(api);
    api.reply(assignConversationTeamFixture.ok());
    api.reply(setConversationPriorityFixture.ok());
    const view = render();
    await view.findByText("Plan tier");
    await choose("Team", "Billing");
    await vi.waitFor(() =>
      expect(api.calls("assignQuillsConversationTeam")).toHaveLength(1),
    );
    await choose("Priority", "Urgent");
    await vi.waitFor(() =>
      expect(api.calls("setQuillsConversationPriority")).toHaveLength(1),
    );
    expect(await api.calls("assignQuillsConversationTeam")[0]!.json()).toEqual({
      teamId: "team_test_1",
    });
    expect(await api.calls("setQuillsConversationPriority")[0]!.json()).toEqual(
      { priority: "urgent" },
    );
  });
});
