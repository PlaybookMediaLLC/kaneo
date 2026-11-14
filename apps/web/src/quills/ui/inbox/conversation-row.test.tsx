import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { ConversationRow, type ConversationRowProps } from "./conversation-row";

const row: ConversationRowProps = {
  href: "/feedback/workspace_1/conversations/conversation_1",
  onOpen: () => undefined,
  person: { name: "Ada Customer" },
  preview: "The export stops at row 100.",
  time: "2026-10-31T12:00:00.000Z",
};

describe("ConversationRow", () => {
  it("shows the avatar, name, date, preview, assignee and status badge", () => {
    const view = renderComponent(
      <ConversationRow
        {...row}
        title="Export"
        unread
        assignee={{ name: "Grace" }}
        badge={{ id: "resolved", label: "Resolved", tone: "success" }}
      />,
    );
    const link = view.getByRole("link");
    expect(link).toHaveAttribute("href", row.href);
    for (const text of [
      "AC",
      "Ada Customer",
      "Unread",
      "Oct 31",
      "Export",
      "The export stops at row 100.",
      "Assigned to Grace",
      "Resolved",
    ])
      expect(link).toHaveTextContent(text);
    expect(view.getByText("Ada Customer")).toHaveClass("font-semibold");
    expect(view.getByText("Oct 31")).toHaveAttribute("datetime", row.time);
  });

  it("shows no assignee, badge or unread mark when there is none", () => {
    const view = renderComponent(<ConversationRow {...row} />);
    expect(view.getByRole("link")).not.toHaveTextContent(/Assigned|Unread/);
    expect(view.getByText("Ada Customer")).toHaveClass("font-medium");
  });

  it("opens in the app on a plain click", () => {
    const onOpen = vi.fn();
    const view = renderComponent(<ConversationRow {...row} onOpen={onOpen} />);
    fireEvent.click(view.getByRole("link"));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
