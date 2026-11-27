import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { ReplyGuardrailBanner } from "./reply-guardrail-banner";
import { ScheduledSendFooter } from "./scheduled-send-footer";

describe("ScheduledSendFooter (#323)", () => {
  it("renders without throwing when scheduledSendAt is malformed", () => {
    const view = renderComponent(
      <ScheduledSendFooter
        scheduledSendAt="not-a-valid-date"
        onUndo={vi.fn()}
        onSendNow={vi.fn()}
      />,
    );
    expect(view.getByRole("status")).toHaveTextContent(/sending/i);
  });

  it("hides Undo and Send now buttons when canManage is false", () => {
    const view = renderComponent(
      <ScheduledSendFooter
        scheduledSendAt={new Date(Date.now() + 30_000).toISOString()}
        canManage={false}
        onUndo={vi.fn()}
        onSendNow={vi.fn()}
      />,
    );
    expect(view.queryByRole("button", { name: /undo/i })).toBeNull();
  });
});

describe("ReplyGuardrailBanner (#324)", () => {
  it("disables Send Anyway button while a send is already in flight", () => {
    const view = renderComponent(
      <ReplyGuardrailBanner
        internalWarning={{
          flagged: true,
          reason: "mention",
          matchedMentions: ["@alex"],
        }}
        confirmingSend
        sending
        replyingTeammates={[]}
        canSwitchToNote
        onSwitchToNote={vi.fn()}
        onConfirmSendAnyway={vi.fn()}
      />,
    );
    const sendAnyway = view.getByRole("button", {
      name: /send.*anyway/i,
    });
    expect(sendAnyway).toBeDisabled();
  });
});
