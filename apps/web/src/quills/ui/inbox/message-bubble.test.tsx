import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { MessageBubble } from "./message-bubble";

const time = "2026-10-31T13:18:00.000Z";

describe("MessageBubble", () => {
  it("puts a customer message on the left in gray, with the author and time", () => {
    const view = renderComponent(
      <MessageBubble
        kind="customer"
        author={{ name: "Ada Customer" }}
        time={time}
      >
        <p>Export fails</p>
      </MessageBubble>,
    );
    const body = view.getByText("Export fails").parentElement!;
    expect(body).toHaveClass("bg-muted");
    expect(body.closest(".flex-row-reverse")).toBeNull();
    expect(view.getByText("Ada Customer")).toBeVisible();
    expect(view.container.querySelector("time")).toHaveAttribute(
      "datetime",
      time,
    );
  });

  it("puts a team reply on the right in blue and shows a delivery failure", () => {
    const view = renderComponent(
      <MessageBubble
        kind="team"
        author={{ name: "Grace" }}
        time={time}
        failure="Email failed"
      >
        <p>Fixed</p>
      </MessageBubble>,
    );
    const body = view.getByText("Fixed").parentElement!;
    expect(body).toHaveClass("bg-info-foreground");
    expect(body.closest(".flex-row-reverse")).not.toBeNull();
    expect(view.getByRole("status")).toHaveTextContent("Email failed");
  });

  it("labels an internal note", () => {
    const view = renderComponent(
      <MessageBubble kind="note" author={{ name: "Grace" }} time={time}>
        <p>Check the logs</p>
      </MessageBubble>,
    );
    expect(view.getByText("Note")).toBeVisible();
    expect(view.getByText("Check the logs").parentElement).toHaveClass(
      "bg-warning/10",
    );
  });
});
