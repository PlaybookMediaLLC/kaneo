// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vite-plus/test";
import { render, fireEvent } from "@testing-library/react";
import { WidgetView } from "../src/ui/WidgetView";
import { createPanel } from "../src/core/panel";

describe("Widget WCAG 2.2 AA landmarks, live regions, dialog and focus trap (#317)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders role=main and announces conversation messages via role=log aria-live=polite", () => {
    const { container, getByText } = render(
      <WidgetView
        onClose={vi.fn()}
        initialTab="messages"
        conversations={[
          {
            id: "conv_1",
            title: "Order issue",
            messages: [
              {
                id: "m1",
                author: "Alex",
                body: "Hello, how can I help?",
                sentAt: "2026-11-26T12:00:00Z",
                fromVisitor: false,
              },
            ],
          },
        ]}
      />,
    );
    expect(container.querySelector('[role="main"]')).not.toBeNull();
    fireEvent.click(getByText("Order issue"));
    const log = container.querySelector('[role="log"]');
    expect(log).not.toBeNull();
    expect(log?.getAttribute("aria-live")).toBe("polite");
  });

  it("closes on Escape and traps Tab focus within the widget", () => {
    const onClose = vi.fn();
    const { container } = render(<WidgetView onClose={onClose} closable />);
    const section = container.querySelector(".qb-widget") as HTMLElement;
    const buttons = Array.from(
      section.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
    );
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    // Mock layout rect so happy-dom reports focusable elements as visible.
    for (const btn of buttons) {
      btn.getClientRects = () =>
        [{ width: 32, height: 32 }] as unknown as DOMRectList;
    }
    const first = buttons[0]!;
    const last = buttons[buttons.length - 1]!;

    last.focus();
    fireEvent.keyDown(section, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(section, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(section, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("gives floating panel role=dialog and toggles aria-modal on show/hide", () => {
    const panel = createPanel({
      widgetUrl: "https://example.com/api/quills-public/acme/widget",
      placement: "right",
      onBackdropClick: vi.fn(),
    });
    const el = document.querySelector(".quackback-panel") as HTMLElement;
    expect(el.getAttribute("role")).toBe("dialog");
    expect(el.getAttribute("aria-modal")).toBe("false");
    panel.show();
    expect(el.getAttribute("aria-modal")).toBe("true");
    panel.hide();
    expect(el.getAttribute("aria-modal")).toBe("false");
    panel.destroy();
  });
});
