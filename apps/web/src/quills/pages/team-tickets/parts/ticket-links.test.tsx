import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";
import { getTicketFixture } from "../../../api/team/get-ticket.fixture";
import { getTicketLinksFixture } from "../../../api/team/get-ticket-links.fixture";
import { listTicketConversationsFixture } from "../../../api/team/list-ticket-conversations.fixture";
import { listTicketExternalLinksFixture } from "../../../api/team/list-ticket-external-links.fixture";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { TicketLinks } from "./ticket-links";

const issue = (id: string, externalUrl: string | null) => ({
  id,
  integrationType: "github",
  externalId: id,
  externalDisplayId: `acme/app#${id}`,
  externalUrl,
  createdAt: "2026-11-01T00:00:00.000Z",
});

function render() {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return renderComponent(
    <RouterContextProvider router={router}>
      <TeamRuntimeProvider
        value={{
          workspaceId: "workspace_test_1",
          viewer: { kind: "user", id: "user_test_1" },
          permissions: {
            read: true,
            create: false,
            update: false,
            delete: false,
            manageSettings: false,
          },
        }}
      >
        <TicketLinks ticketId="ticket_test_1" />
      </TeamRuntimeProvider>
    </RouterContextProvider>,
  );
}

describe("TicketLinks", () => {
  it("links the conversations, the tracker and the external issues", async () => {
    const api = mockApi();
    api.reply(
      listTicketConversationsFixture.ok({
        pairConversationId: "conversation_pair",
        provenanceConversationIds: ["conversation_pair", "conversation_source"],
        count: 2,
      }),
    );
    api.reply(
      getTicketLinksFixture.ok({
        tracker: getTicketFixture.ok({
          id: "ticket_tracker",
          reference: "T-9",
          title: "Login outage",
        }),
        linked: [],
      }),
    );
    api.reply(
      listTicketExternalLinksFixture.ok({
        links: [
          issue("12", "https://github.com/acme/app/issues/12"),
          issue("13", "javascript:alert(1)"),
        ],
      }),
    );
    const view = render();
    expect(
      await view.findByRole("link", { name: "Customer conversation" }),
    ).toHaveAttribute(
      "href",
      "/feedback/workspace_test_1/conversations/conversation_pair",
    );
    expect(
      view.getByRole("link", { name: "Linked conversation 1" }),
    ).toHaveAttribute(
      "href",
      "/feedback/workspace_test_1/conversations/conversation_source",
    );
    expect(
      view.getByRole("link", { name: "T-9 Login outage" }),
    ).toHaveAttribute(
      "href",
      "/feedback/workspace_test_1/tickets/ticket_tracker",
    );
    expect(
      view.getByRole("link", { name: "github acme/app#12" }),
    ).toHaveAttribute("href", "https://github.com/acme/app/issues/12");
    expect(view.queryByRole("link", { name: "github acme/app#13" })).toBeNull();
    expect(view.getByText("github acme/app#13")).toBeInTheDocument();
  });

  it("says when the ticket has no links", async () => {
    const api = mockApi();
    api.reply(listTicketConversationsFixture.ok());
    api.reply(getTicketLinksFixture.ok({ tracker: null }));
    api.reply(listTicketExternalLinksFixture.ok());
    const view = render();
    expect(await view.findByText("No links yet.")).toBeInTheDocument();
  });
});
