import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { fill, press } from "../../test/actions";
import { renderPage } from "../../test/render";
import type { ListContext } from "./conversation-list";
import {
  ConversationListPane,
  type ConversationListPaneProps,
} from "./conversation-list-pane";
import { meta } from "./meta";

const billing = {
  id: "view_test_1",
  name: "Billing",
  filters: { rules: [] },
  sort: null,
  isShared: true,
  isPinned: true,
  createdByPrincipalId: null,
};

function renderPane(
  context: ListContext,
  props: Partial<ConversationListPaneProps> = {},
  permissions = {},
) {
  const Pane = () => (
    <ConversationListPane
      workspaceId="workspace_test_1"
      context={context}
      views={[billing]}
      headingLevel={1}
      onSearch={() => undefined}
      {...props}
    >
      <p>Rows</p>
    </ConversationListPane>
  );
  return renderPage(Pane, meta, { permissions });
}

describe("ConversationListPane", () => {
  it("titles the list by its filter and moves to another filter from the menu", async () => {
    const view = renderPane({ view: "mine", status: "open", search: "tax" });
    expect(
      view.getByRole("heading", { level: 1, name: "Mine" }),
    ).toBeInTheDocument();
    expect(view.getByText("Rows")).toBeInTheDocument();
    press("Filters");
    expect(
      await view.findByRole("menuitemradio", { name: "Mine" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      view.getByRole("menuitemradio", { name: "Billing" }),
    ).toBeInTheDocument();
    fireEvent.click(view.getByRole("menuitemradio", { name: "Resolved" }));
    await waitFor(() =>
      expect(view.router.state.location.href).toBe(
        "/feedback/workspace_test_1/conversations/all?status=closed&q=tax",
      ),
    );
  });

  it("opens the queue and a new message", async () => {
    const view = renderPane({ view: "all", status: "any" });
    press("Queue");
    await waitFor(() =>
      expect(view.router.state.location.href).toBe(
        "/feedback/workspace_test_1/conversations/queue?status=open&next=true",
      ),
    );
    press("New message");
    await waitFor(() =>
      expect(view.router.state.location.href).toBe(
        "/feedback/workspace_test_1/conversations/all?status=any&new=true",
      ),
    );
  });

  it("searches after a pause in typing", async () => {
    const onSearch = vi.fn();
    renderPane({ view: "all", status: "any" }, { onSearch });
    fill("Search conversations…", "  refund ");
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith("refund"));
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("saves a list as a view, but not the spam list", async () => {
    const onSaveView = vi.fn();
    const view = renderPane({ view: "all", status: "spam" }, { onSaveView });
    press("Filters");
    expect(
      await view.findByRole("menuitem", { name: "Save as view…" }),
    ).toHaveAttribute("aria-disabled", "true");
    view.unmount();
    const other = renderPane({ view: "open", status: "open" }, { onSaveView });
    press("Filters");
    fireEvent.click(
      await other.findByRole("menuitem", { name: "Save as view…" }),
    );
    expect(onSaveView).toHaveBeenCalledTimes(1);
  });

  it("offers no new message without the update permission", () => {
    const view = renderPane(
      { view: "all", status: "any" },
      {},
      { update: false },
    );
    expect(view.getByRole("button", { name: "New message" })).toBeDisabled();
  });
});
