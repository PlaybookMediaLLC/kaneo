import { fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { addConversationNoteFixture } from "../../../api/team/add-conversation-note.fixture";
import { createFilesFixture } from "../../../api/team/create-files.fixture";
import { createUploadFixture } from "../../../api/team/create-upload.fixture";
import { replyConversationFixture } from "../../../api/team/reply-conversation.fixture";
import { sendConversationTypingFixture } from "../../../api/team/send-conversation-typing.fixture";
import {
  type TeamPermissions,
  TeamRuntimeProvider,
} from "../../../team/runtime";
import { fill, press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { renderComponent } from "../../../test/render";
import { ShortcutListener } from "../../../ui/upstream";
import { ConversationComposer } from "./conversation-composer";

const all = {
  read: true,
  create: true,
  update: true,
  delete: true,
  manageSettings: true,
};
const render = (
  element: ReactElement,
  permissions: Partial<TeamPermissions> = {},
) =>
  renderComponent(
    <TeamRuntimeProvider
      value={{
        workspaceId: "workspace_test_1",
        viewer: { kind: "user", id: "user_test_1" },
        permissions: { ...all, ...permissions },
      }}
    >
      <ShortcutListener />
      {element}
    </TeamRuntimeProvider>,
  );
const composer = (
  <ConversationComposer
    workspaceId="workspace_test_1"
    conversationId="conversation_test_1"
    customerName="Grace"
  />
);

describe("ConversationComposer", () => {
  it("inserts a picked emoji at the caret", async () => {
    mockApi().reply(sendConversationTypingFixture.ok());
    const view = render(composer);
    fill("Reply to Grace…", "Thanks!");
    const box = view.getByLabelText("Reply to Grace…") as HTMLTextAreaElement;
    box.setSelectionRange(6, 6);
    press("Add an emoji");
    fireEvent.click(await view.findByRole("menuitem", { name: "Insert 🎉" }));
    expect(box).toHaveValue("Thanks🎉!");
  });

  it("uploads the chosen files and sends them with the reply", async () => {
    const api = mockApi();
    api.reply(sendConversationTypingFixture.ok());
    api.reply(
      createUploadFixture.ok({
        key: "workspace/quills/file/a.pdf",
        uploadUrl: "https://storage.example.test/upload",
      }),
    );
    api.reply({});
    api.reply(createFilesFixture.ok({ id: "file_test_1" }));
    api.reply(replyConversationFixture.ok());
    const view = render(composer);
    const invoice = new File(["%PDF"], "invoice.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(view.getByLabelText("Attach files"), {
      target: { files: [invoice] },
    });
    expect(view.getByText("invoice.pdf")).toBeInTheDocument();
    fill("Reply to Grace…", "Here it is");
    press("Send to customer");
    await vi.waitFor(() =>
      expect(api.calls("replyQuillsConversation")).toHaveLength(1),
    );
    expect(await api.calls("createQuillsUpload")[0]!.json()).toMatchObject({
      purpose: "file",
      filename: "invoice.pdf",
      contentType: "application/pdf",
      size: 4,
    });
    expect(await api.calls("replyQuillsConversation")[0]!.json()).toEqual({
      content: "Here it is",
      attachmentIds: ["file_test_1"],
    });
    await vi.waitFor(() => expect(view.queryByText("invoice.pdf")).toBeNull());
  });

  it("keeps text typed while the files uploaded", async () => {
    const api = mockApi();
    api.reply(sendConversationTypingFixture.ok());
    api.reply(
      createUploadFixture.ok({ uploadUrl: "https://storage.example.test/up" }),
    );
    api.reply({});
    api.reply(createFilesFixture.ok({ id: "file_test_1" }));
    let finish = () => {};
    api.defer(({ resolve }) => {
      finish = () => resolve(replyConversationFixture.ok());
    });
    const view = render(composer);
    fireEvent.change(view.getByLabelText("Attach files"), {
      target: {
        files: [new File(["x"], "a.pdf", { type: "application/pdf" })],
      },
    });
    fill("Reply to Grace…", "First");
    press("Send to customer");
    await vi.waitFor(() =>
      expect(api.calls("replyQuillsConversation")).toHaveLength(1),
    );
    fill("Reply to Grace…", "Next message");
    finish();
    await vi.waitFor(() => expect(view.queryByText("a.pdf")).toBeNull());
    expect(view.getByLabelText("Reply to Grace…")).toHaveValue("Next message");
  });

  it("signals typing once, sends the reply with Enter and clears the box", async () => {
    const api = mockApi();
    api.reply(sendConversationTypingFixture.ok());
    api.reply(replyConversationFixture.ok());
    const view = render(composer);
    fill("Reply to Grace…", "Fixed");
    fill("Reply to Grace…", "Fixed now ");
    fireEvent.keyDown(view.getByLabelText("Reply to Grace…"), { key: "Enter" });
    await vi.waitFor(() =>
      expect(view.getByLabelText("Reply to Grace…")).toHaveValue(""),
    );
    expect(api.calls("sendQuillsConversationTyping")).toHaveLength(1);
    const [reply] = api.calls("replyQuillsConversation");
    expect(new URL(reply!.url).pathname).toBe(
      "/api/quills/workspace_test_1/conversations/conversation_test_1/reply",
    );
    expect(await reply!.json()).toEqual({ content: "Fixed now" });
  });

  it("switches to a note with N, sends no typing signal, and keeps the text when it fails", async () => {
    const api = mockApi();
    const failed = addConversationNoteFixture.problem(429);
    api.reply(failed.body, failed.status);
    const view = render(composer);
    fireEvent.keyDown(document.body, { key: "n", code: "KeyN" });
    const box = await view.findByLabelText("Write a note for the team…");
    expect(box).toHaveFocus();
    fill("Write a note for the team…", "Check the invoice");
    press("Add note");
    expect(await view.findByRole("alert")).toBeInTheDocument();
    expect(box).toHaveValue("Check the invoice");
    expect(api.calls("sendQuillsConversationTyping")).toHaveLength(0);
    expect(api.calls("addQuillsConversationNote")).toHaveLength(1);
  });

  it("offers only notes without the update permission", () => {
    const view = render(composer, { update: false });
    expect(
      view.getByLabelText("Write a note for the team…"),
    ).toBeInTheDocument();
    expect(view.queryByRole("button", { name: /^Mode/ })).toBeNull();
  });
});
