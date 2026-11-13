import { describe, expect, it, vi } from "vite-plus/test";
import { fill, press } from "../../../test/actions";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { NewConversationForm } from "./new-conversation-form";

describe("NewConversationForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(
        <NewConversationForm
          idempotencyKey="request_key_1"
          onSubmit={onSubmit}
        />,
      ),
    fieldName: "How can we help?",
    issuePath: "content",
    submitName: "Send message",
    validValue: "Please help",
    expectedValues: { content: "Please help", idempotencyKey: "request_key_1" },
    invalidValue: "",
  });
  it("submits the message with the stable idempotency key", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = renderComponent(
      <NewConversationForm
        idempotencyKey="request_key_1"
        onSubmit={onSubmit}
      />,
    );
    expect(
      view.getByRole("textbox", { name: "How can we help?" }),
    ).toBeInTheDocument();
    fill("How can we help?", "Please help");
    press("Send message");
    await vi.waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        content: "Please help",
        idempotencyKey: "request_key_1",
      }),
    );
  });
});
