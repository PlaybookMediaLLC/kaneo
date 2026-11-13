import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { ConversationMessages } from "./conversation-messages";
describe("ConversationMessages", () => {
  it("shows the empty state", () => {
    const view = renderComponent(<ConversationMessages messages={[]} />);
    expect(
      view.getByRole("heading", { name: /messages/i }),
    ).toBeInTheDocument();
    expect(view.getByText(/no messages yet/i)).toBeInTheDocument();
  });

  it("renders safe message content and attachment names", () => {
    const view = renderComponent(
      <ConversationMessages
        messages={[
          {
            id: "message_test_1",
            fromVisitor: false,
            senderType: "agent",
            author: { name: "Sam" },
            content: "**We can help**",
            attachments: [{ name: "answer.pdf" }],
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
      />,
    );
    expect(view.getByText("**We can help**")).toBeInTheDocument();
    expect(view.getByText(/answer\.pdf/i)).toBeInTheDocument();
  });
});
