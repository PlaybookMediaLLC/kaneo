import { describe, expect, it, vi } from "vite-plus/test";
import { fill, press } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { ConversationReplyForm } from "./conversation-reply-form";
describe("ConversationReplyForm", () => {
  it("labels the reply field", () => {
    const view = renderComponent(
      <ConversationReplyForm onSubmit={async () => {}} />,
    );
    expect(view.getByRole("textbox", { name: /reply/i })).toBeInTheDocument();
    expect(
      view.getByRole("button", { name: /send reply/i }),
    ).toBeInTheDocument();
  });

  it("submits and clears a valid reply", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = renderComponent(<ConversationReplyForm onSubmit={onSubmit} />);
    fill(/reply/i, "Please help");
    press(/send reply/i);
    await vi.waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith("Please help"),
    );
    await vi.waitFor(() =>
      expect(view.getByRole("textbox", { name: /reply/i })).toHaveValue(""),
    );
  });
});
