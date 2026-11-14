import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { createConversationViewFixture } from "../../../api/team/create-conversation-view.fixture";
import { fill, press } from "../../../test/actions";
import { mockApi } from "../../../test/mock-api";
import { TeamRuntimeProvider } from "../../../team/runtime";
import { renderComponent } from "../../../test/render";
import type { ListContext } from "../conversation-list";
import { SaveViewDialog } from "./save-view-dialog";

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

function renderForm(context: ListContext) {
  const onSaved = vi.fn();
  const view = renderComponent(
    <TeamRuntimeProvider value={team}>
      <SaveViewDialog
        workspaceId="workspace_test_1"
        context={context}
        open
        onOpenChange={() => undefined}
        onSaved={onSaved}
      />
    </TeamRuntimeProvider>,
  );
  return { view, onSaved };
}

describe("SaveViewDialog", () => {
  it("saves the current list as a named view", async () => {
    const api = mockApi();
    api.reply(createConversationViewFixture.ok({ id: "view_test_5" }));
    const { view, onSaved } = renderForm({ view: "mine", status: "snoozed" });
    expect(
      await view.findByRole("heading", { name: "Save as view" }),
    ).toBeInTheDocument();
    fill("View name", "My snoozed");
    press("Save view");
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("view_test_5"));
    expect(await api.calls("createQuillsConversationView")[0]!.json()).toEqual({
      name: "My snoozed",
      filters: {
        rules: [
          { field: "assignee", value: "me" },
          { field: "status", value: "snoozed" },
        ],
      },
      sort: "recent",
    });
  });

  it("asks for a name", async () => {
    const api = mockApi();
    const { view } = renderForm({ view: "queue", status: "open" });
    await view.findByRole("heading", { name: "Save as view" });
    press("Save view");
    await waitFor(() =>
      expect(view.getByLabelText("View name")).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    expect(api.calls()).toHaveLength(0);
  });
});
