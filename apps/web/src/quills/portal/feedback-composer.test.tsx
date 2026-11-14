import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { createPortalPostFixture } from "../api/feedback/create-portal-post.fixture";
import { createPortalUploadFixture } from "../api/files/create-portal-upload.fixture";
import { preparePortalUploadFixture } from "../api/files/prepare-portal-upload.fixture";
import { fill, press } from "../test/actions";
import { mockApi } from "../test/mock-api";
import { renderComponent } from "../test/render";
import { FeedbackComposer } from "./feedback-composer";
import { PortalRuntimeProvider, type PortalRuntimeValue } from "./runtime";

const runtime: PortalRuntimeValue = {
  config: {
    name: "Workspace",
    features: {
      allowAnonymous: false,
      allowEditAfterEngagement: false,
      allowDeleteAfterEngagement: false,
      showPublicEditHistory: false,
    },
    portalAccess: { isPrivate: false },
    branding: {
      logoUrl: null,
      theme: { themeMode: "user", light: {}, dark: {} },
      headerDisplayMode: "logo_and_name",
      headerDisplayName: null,
    },
  },
  viewer: { kind: "user", id: "account_test_1" },
  access: { granted: true, reason: "public" },
  accessLoading: false,
  accessProblem: null,
};

describe("FeedbackComposer", () => {
  it("offers a retry and keeps the draft when the file storage fails", async () => {
    const api = mockApi();
    api.reply(preparePortalUploadFixture.ok());
    api.reply(createPortalUploadFixture.ok());
    api.fail(new TypeError("Failed to fetch"));
    const view = renderComponent(
      <PortalRuntimeProvider value={runtime}>
        <FeedbackComposer
          workspaceId="workspace_test_1"
          boards={[{ id: "board_test_1", name: "Ideas" }]}
          onTitleChange={vi.fn()}
        />
      </PortalRuntimeProvider>,
    );
    fireEvent.focus(view.getByLabelText("Title"));
    fill("Title", "Export to CSV");
    fireEvent.change(view.getByLabelText("Attach files"), {
      target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] },
    });
    press("Submit feedback");
    expect(
      await view.findByRole("button", { name: "Try again" }),
    ).toBeEnabled();
    expect(view.getByLabelText("Title")).toHaveValue("Export to CSV");
    expect(api.calls("createQuillsPortalPost")).toHaveLength(0);
  });

  it("creates a post with a draft key and no files", async () => {
    const api = mockApi();
    api.reply(createPortalPostFixture.ok());
    const view = renderComponent(
      <PortalRuntimeProvider value={runtime}>
        <FeedbackComposer
          workspaceId="workspace_test_1"
          boards={[{ id: "board_test_1", name: "Ideas" }]}
          onTitleChange={vi.fn()}
        />
      </PortalRuntimeProvider>,
    );
    fireEvent.focus(view.getByLabelText("Title"));
    fill("Title", "Export to CSV");
    expect(view.getByLabelText("Attach files")).toBeInTheDocument();
    press("Submit feedback");
    await waitFor(() =>
      expect(api.calls("createQuillsPortalPost")).toHaveLength(1),
    );
    const [request] = api.calls("createQuillsPortalPost");
    expect(await request!.json()).toMatchObject({
      boardId: "board_test_1",
      title: "Export to CSV",
      attachmentIds: [],
      idempotencyKey: expect.any(String),
    });
  });
});
