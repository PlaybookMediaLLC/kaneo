import { describe, expect, it } from "vite-plus/test";
import { getTicketWatchStatusFixture } from "../../../api/team/get-ticket-watch-status.fixture";
import { listTicketWatchersFixture } from "../../../api/team/list-ticket-watchers.fixture";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { TicketWatchers } from "./ticket-watchers";

function render(
  status = getTicketWatchStatusFixture.ok(),
  watchers = listTicketWatchersFixture.ok(),
) {
  const api = mockApi();
  api.reply(status);
  api.reply(watchers);
  return renderComponent(
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
      <TicketWatchers ticketId="ticket_test_1" />
    </TeamRuntimeProvider>,
  );
}

describe("TicketWatchers", () => {
  it("lists the watchers", async () => {
    const view = render(
      getTicketWatchStatusFixture.ok(),
      listTicketWatchersFixture.ok({
        items: [
          {
            principalId: "principal_grace",
            reason: "requester",
            mutedUntil: null,
            displayName: "Grace",
            avatarUrl: null,
            teammate: false,
          },
        ],
      }),
    );
    expect(await view.findByText("Grace")).toBeInTheDocument();
    expect(view.queryByText(/^Muted until/)).toBeNull();
  });

  it("says until when the caller muted the ticket", async () => {
    const view = render(
      getTicketWatchStatusFixture.ok({
        watching: true,
        mutedUntil: "2999-01-01T00:00:00.000Z",
      }),
    );
    expect(await view.findByText("No watchers yet.")).toBeInTheDocument();
    expect(await view.findByText(/^Muted until/)).toBeInTheDocument();
  });
});
