import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { getConversationFixture } from "../../../api/team/get-conversation.fixture";
import { renderComponent } from "../../../test/render";
import { ConversationListPane } from "./conversation-list-pane";

const item = (id: string, values = {}) => ({
  ...getConversationFixture.ok(),
  id,
  visitorName: `Customer ${id}`,
  ...values,
});

describe("ConversationListPane", () => {
  it("shows the rows of the list with the open one selected", () => {
    const onOpen = vi.fn();
    const view = renderComponent(
      <ConversationListPane
        workspaceId="workspace_test_1"
        context={{ view: "mine", status: "open" }}
        items={[item("c1"), item("c2", { status: "closed" })]}
        people={[]}
        activeId="c2"
        onOpen={onOpen}
        loading={false}
      />,
    );
    expect(
      view.getByRole("heading", { level: 2, name: "My conversations" }),
    ).toBeVisible();
    const open = view.getByRole("link", { name: /Customer c2/ });
    expect(open).toHaveAttribute("aria-current", "true");
    expect(open).toHaveAttribute(
      "href",
      "/feedback/workspace_test_1/conversations/c2?view=mine&status=open",
    );
    expect(open).toHaveTextContent("Closed");
    fireEvent.click(view.getByRole("link", { name: /Customer c1/ }));
    expect(onOpen).toHaveBeenCalledWith("c1");
  });
});
