import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";
import { createPostFromConversationFixture } from "../../../api/team/create-post-from-conversation.fixture";
import { getConversationTicketLinkFixture } from "../../../api/team/get-conversation-ticket-link.fixture";
import { getLinkedPostsForConversationFixture } from "../../../api/team/get-linked-posts-for-conversation.fixture";
import { listBoardsFixture } from "../../../api/team/list-boards.fixture";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { fill, press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { LinksSection } from "./links-section";

const team = (create = true) => ({
  workspaceId: "workspace_test_1",
  viewer: { kind: "user" as const, id: "user_test_1" },
  permissions: {
    read: true,
    create,
    update: true,
    delete: true,
    manageSettings: true,
  },
});
// The links are router links, so the section renders inside a router.
const render = (create = true) =>
  renderComponent(
    <RouterContextProvider
      router={createRouter({
        routeTree: createRootRoute(),
        history: createMemoryHistory(),
      })}
    >
      <TeamRuntimeProvider value={team(create)}>
        <LinksSection
          workspaceId="workspace_test_1"
          conversationId="conversation_test_1"
        />
      </TeamRuntimeProvider>
    </RouterContextProvider>,
  );
const board = {
  id: "board_test_1",
  name: "Ideas",
  slug: "ideas",
  description: null,
  access: {
    view: "anonymous" as const,
    vote: "anonymous" as const,
    comment: "anonymous" as const,
    submit: "anonymous" as const,
    segments: { view: [], vote: [], comment: [], submit: [] },
    moderation: {
      anonPosts: "inherit" as const,
      signedPosts: "inherit" as const,
      comments: "inherit" as const,
    },
  },
  visibleSegmentIds: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("LinksSection", () => {
  it("links the customer ticket and the posts in the teammate app", async () => {
    const api = mockApi();
    api.reply(
      getConversationTicketLinkFixture.ok({
        ticket: {
          id: "ticket_test_1",
          number: 12,
          reference: "#12",
          title: "Refund",
          status: { name: "Waiting", category: "pending" },
        },
      }),
    );
    api.reply(
      getLinkedPostsForConversationFixture.ok({
        items: [
          {
            postId: "post_test_1",
            title: "Faster export",
            boardId: "board_test_1",
            boardSlug: "ideas",
          },
        ],
      }),
    );
    const view = render();
    expect(
      await view.findByRole("link", { name: "#12 Refund · Waiting" }),
    ).toHaveAttribute(
      "href",
      "/feedback/workspace_test_1/tickets/ticket_test_1",
    );
    expect(view.getByRole("link", { name: "Faster export" })).toHaveAttribute(
      "href",
      "/feedback/workspace_test_1/posts/post_test_1",
    );
  });

  it("creates a post from the conversation on a board", async () => {
    const api = mockApi();
    api.reply(getConversationTicketLinkFixture.ok());
    api.reply(getLinkedPostsForConversationFixture.ok());
    api.reply(listBoardsFixture.ok({ items: [board] }));
    api.reply(createPostFromConversationFixture.ok());
    api.reply(getLinkedPostsForConversationFixture.ok());
    const view = render();
    await vi.waitFor(() => expect(view.getAllByText("None")).toHaveLength(2));
    press("Create request");
    await view.findByLabelText("Request title");
    fill("Request title", "Faster export");
    press("Create request");
    expect(
      await view.findByText("Created the request “Faster export”."),
    ).toBeInTheDocument();
    expect(
      await api.calls("createQuillsPostFromConversation")[0]!.json(),
    ).toEqual({ boardId: "board_test_1", title: "Faster export", content: "" });
  });

  it("offers no post creation without the create permission", async () => {
    const api = mockApi();
    api.reply(getConversationTicketLinkFixture.ok());
    api.reply(getLinkedPostsForConversationFixture.ok());
    const view = render(false);
    expect(view.getByRole("button", { name: "Create request" })).toBeDisabled();
    await vi.waitFor(() => expect(api.calls()).toHaveLength(2));
  });
});
