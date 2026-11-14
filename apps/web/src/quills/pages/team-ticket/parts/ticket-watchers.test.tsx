import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { getTicketWatchStatusFixture } from "../../../api/team/get-ticket-watch-status.fixture";
import { listTicketWatchersFixture } from "../../../api/team/list-ticket-watchers.fixture";
import { muteTicketFixture } from "../../../api/team/mute-ticket.fixture";
import { watchTicketFixture } from "../../../api/team/watch-ticket.fixture";
import { press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { TicketWatchers } from "./ticket-watchers";

const watchers = listTicketWatchersFixture.ok({
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
});

function render(watching: boolean) {
  const api = mockApi();
  api.reply(
    getTicketWatchStatusFixture.ok({
      watching,
      reason: watching ? "manual" : null,
    }),
  );
  api.reply(watchers);
  const view = renderComponent(
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
  return { api, view };
}

describe("TicketWatchers", () => {
  it("lists the watchers and lets a reader watch the ticket", async () => {
    const { api, view } = render(false);
    expect(await view.findByText("Grace")).toBeInTheDocument();
    api.reply(watchTicketFixture.ok({ watching: true, reason: "manual" }));
    api.reply(getTicketWatchStatusFixture.ok({ watching: true }));
    api.reply(watchers);
    press("Watch");
    expect(
      await view.findByRole("button", { name: "Stop watching" }),
    ).toBeInTheDocument();
    const [watch] = api.calls("watchQuillsTicket");
    expect(new URL(watch!.url).pathname).toBe(
      "/api/quills/workspace_test_1/tickets/ticket_test_1/watch",
    );
  });

  it("mutes a watched ticket for a week", async () => {
    const { api, view } = render(true);
    await view.findByText("Grace");
    api.reply(muteTicketFixture.ok({ watching: true }));
    api.reply(getTicketWatchStatusFixture.ok({ watching: true }));
    api.reply(watchers);
    press("Mute for 7 days");
    await waitFor(() => expect(api.calls("muteQuillsTicket")).toHaveLength(1));
    expect(await api.calls("muteQuillsTicket")[0]!.clone().json()).toEqual({
      days: 7,
    });
  });

  it("offers unmute while the ticket is muted", async () => {
    const api = mockApi();
    api.reply(
      getTicketWatchStatusFixture.ok({
        watching: true,
        mutedUntil: "2999-01-01T00:00:00.000Z",
      }),
    );
    api.reply(listTicketWatchersFixture.ok());
    const view = renderComponent(
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
    expect(
      await view.findByRole("button", { name: "Unmute" }),
    ).toBeInTheDocument();
    expect(view.getByText("No watchers yet.")).toBeInTheDocument();
    expect(view.getByText(/^Muted until/)).toBeInTheDocument();
  });
});
