import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { addTicketNoteFixture } from "../../../api/team/add-ticket-note.fixture";
import { getTicketFixture } from "../../../api/team/get-ticket.fixture";
import { listTicketActivityFixture } from "../../../api/team/list-ticket-activity.fixture";
import { listTicketMessagesFixture } from "../../../api/team/list-ticket-messages.fixture";
import { replyTicketFixture } from "../../../api/team/reply-ticket.fixture";
import { fill, press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import {
  TeamRuntimeProvider,
  type TeamPermissions,
} from "../../../team/runtime";
import { ShortcutListener } from "../../../ui/upstream";
import { TicketThread } from "./ticket-thread";

const all = {
  read: true,
  create: true,
  update: true,
  delete: true,
  manageSettings: true,
};
const message = listTicketMessagesFixture.ok({
  items: [
    {
      id: "message_1",
      ticketId: "ticket_test_1",
      conversationId: null,
      senderType: "visitor",
      isInternal: false,
      author: { principalId: "principal_grace", displayName: "Grace" },
      content: "The login fails.",
      systemEvent: null,
      createdAt: "2026-11-02T00:00:00.000Z",
    },
  ],
});
const ticket = getTicketFixture.ok({
  id: "ticket_test_1",
  requester: {
    principalId: "principal_grace",
    displayName: "Grace",
    avatarUrl: null,
  },
});

function render(permissions: TeamPermissions = all) {
  const api = mockApi();
  api.reply(message);
  api.reply(listTicketActivityFixture.ok());
  const view = renderComponent(
    <TeamRuntimeProvider
      value={{
        workspaceId: "workspace_test_1",
        viewer: { kind: "user", id: "user_test_1" },
        permissions,
      }}
    >
      <ShortcutListener />
      <TicketThread ticket={ticket} />
    </TeamRuntimeProvider>,
  );
  return { api, view };
}

const refreshed = (api: ReturnType<typeof mockApi>) => {
  api.reply(message);
  api.reply(listTicketActivityFixture.ok());
};

describe("TicketThread", () => {
  it("reads the thread with the internal notes and sends a reply on Enter", async () => {
    const { api, view } = render();
    expect(await view.findByText("The login fails.")).toBeInTheDocument();
    const [list] = api.calls("listQuillsTicketMessages");
    expect(new URL(list!.url).searchParams.get("includeInternal")).toBe("true");
    api.reply(replyTicketFixture.ok());
    refreshed(api);
    const box = view.getByRole("textbox", { name: "Reply to Grace…" });
    fill("Reply to Grace…", " We fixed it. ");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(box).toHaveValue(""));
    const [reply] = api.calls("replyQuillsTicket");
    expect(new URL(reply!.url).pathname).toBe(
      "/api/quills/workspace_test_1/tickets/ticket_test_1/reply",
    );
    expect(await reply!.clone().json()).toEqual({ content: "We fixed it." });
  });

  it("starts a note with N and a reply with R", async () => {
    const { api, view } = render();
    await view.findByText("The login fails.");
    fireEvent.keyDown(document.body, { key: "n", code: "KeyN" });
    const note = view.getByRole("textbox", { name: "Write an internal note…" });
    expect(note).toHaveFocus();
    api.reply(addTicketNoteFixture.ok());
    refreshed(api);
    fill("Write an internal note…", "Ask billing.");
    press("Send");
    await waitFor(() =>
      expect(api.calls("addQuillsTicketNote")).toHaveLength(1),
    );
    expect(await api.calls("addQuillsTicketNote")[0]!.clone().json()).toEqual({
      content: "Ask billing.",
    });
    note.blur();
    fireEvent.keyDown(document.body, { key: "r", code: "KeyR" });
    expect(
      view.getByRole("textbox", { name: "Reply to Grace…" }),
    ).toHaveFocus();
  });

  it("keeps the text and says so when the message is not sent", async () => {
    const { api, view } = render();
    await view.findByText("The login fails.");
    api.reply({ message: "Too long" }, 400);
    fill("Reply to Grace…", "We fixed it.");
    press("Send");
    expect(await view.findByRole("alert")).toHaveTextContent(
      "The message was not sent.",
    );
    expect(view.getByRole("textbox")).toHaveValue("We fixed it.");
  });

  it("keeps the thread read only without update permission", async () => {
    const { view } = render({ ...all, update: false });
    await view.findByText("The login fails.");
    expect(view.queryByRole("textbox")).toBeNull();
  });

  it("shows a thread that could not load", async () => {
    const api = mockApi();
    api.fail();
    api.fail();
    const view = renderComponent(
      <TeamRuntimeProvider
        value={{
          workspaceId: "workspace_test_1",
          viewer: { kind: "user", id: "user_test_1" },
          permissions: all,
        }}
      >
        <TicketThread ticket={getTicketFixture.ok()} />
      </TeamRuntimeProvider>,
    );
    expect(await view.findByRole("alert")).toBeInTheDocument();
  });
});
