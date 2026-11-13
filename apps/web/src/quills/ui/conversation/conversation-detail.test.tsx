import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { ConversationDetail } from "./conversation-detail";
describe("ConversationDetail", () => {
  it("shows the fallback subject and read-only state", () => {
    const view = renderComponent(
      <ConversationDetail
        conversation={{ subject: null, status: "closed", isReadOnly: true }}
        teamTyping={false}
      />,
    );
    expect(view.getByText(/support conversation/i)).toBeInTheDocument();
    expect(view.getByRole("status")).toHaveTextContent(/read-only/i);
  });

  it("announces typing", () => {
    const view = renderComponent(
      <ConversationDetail
        conversation={{
          subject: "A question",
          status: "open",
          isReadOnly: false,
        }}
        teamTyping
      />,
    );
    expect(view.getByRole("status")).toHaveTextContent(/typing/i);
  });
});
