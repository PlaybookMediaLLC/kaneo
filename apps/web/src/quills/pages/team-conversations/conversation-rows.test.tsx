import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { getConversationFixture } from "../../api/team/get-conversation.fixture";
import { press } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { ConversationRows } from "./conversation-rows";

const item = (id: string, values = {}) => ({
  ...getConversationFixture.ok(),
  id,
  visitorName: `Customer ${id}`,
  ...values,
});

describe("ConversationRows", () => {
  it("links each row to its conversation with the list, and marks the open one", () => {
    const onOpen = vi.fn();
    const load = vi.fn();
    const view = renderComponent(
      <ConversationRows
        workspaceId="workspace_test_1"
        context={{ view: "mine", status: "open" }}
        items={[item("c1"), item("c2", { status: "closed" })]}
        people={[]}
        activeId="c2"
        onOpen={onOpen}
        more={{ loading: false, load }}
      />,
    );
    const open = view.getByRole("link", { name: /Customer c2/ });
    expect(open).toHaveAttribute("aria-current", "true");
    expect(open).toHaveAttribute(
      "href",
      "/feedback/workspace_test_1/conversations/c2?view=mine&status=open",
    );
    expect(open).toHaveTextContent("Resolved");
    fireEvent.click(view.getByRole("link", { name: /Customer c1/ }));
    expect(onOpen).toHaveBeenCalledWith("c1");
    press("Load more conversations");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("has no load button on the last page", () => {
    const view = renderComponent(
      <ConversationRows
        workspaceId="workspace_test_1"
        context={{ view: "all", status: "any" }}
        items={[item("c1")]}
        people={[]}
        activeId={null}
        onOpen={() => undefined}
      />,
    );
    expect(
      view.queryByRole("button", { name: "Load more conversations" }),
    ).not.toBeInTheDocument();
  });
});
