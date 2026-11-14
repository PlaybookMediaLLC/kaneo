import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { SignalRow, type Signal } from "./signal-row";

const post = {
  id: "post_test_1",
  title: "Dark mode",
  voteCount: 1,
  boardName: "Ideas",
  statusName: null,
};
const signal = (overrides: Partial<Signal> = {}): Signal => ({
  id: "feedback_signal_test_1",
  status: "pending",
  source: {
    type: "conversation",
    id: "conversation_test_1",
    title: "Night use",
    number: null,
  },
  customer: { principalId: "principal_test_1", displayName: "Ada" },
  excerpt: "Please add a dark mode.",
  suggestedTitle: "Dark theme",
  matchedPost: post,
  resultingPost: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  decidedAt: null,
  ...overrides,
});
const actions = () => ({
  onAcceptAsPost: vi.fn(),
  onVote: vi.fn(async () => undefined),
  onDismiss: vi.fn(async () => undefined),
  onRestore: vi.fn(async () => undefined),
});
const row = (
  value: Signal,
  calls = actions(),
  can = { canAccept: true, canReview: true },
) =>
  renderComponent(
    <ul>
      <SignalRow signal={value} {...can} {...calls} />
    </ul>,
  );

describe("SignalRow", () => {
  it("shows the excerpt, the source, the customer and the match, and runs each decision", async () => {
    const calls = actions();
    const view = row(signal(), calls);
    expect(view.getByText("Dark theme")).toBeInTheDocument();
    expect(view.getByText("Please add a dark mode.")).toBeInTheDocument();
    expect(view.getByText("Conversation: Night use")).toBeInTheDocument();
    expect(view.getByText("From Ada")).toBeInTheDocument();
    expect(
      view.getByText("Matches “Dark mode” · Ideas · 1 vote"),
    ).toBeInTheDocument();
    press("Accept as a new post: “Dark theme”");
    expect(calls.onAcceptAsPost).toHaveBeenCalledTimes(1);
    press("Add the customer's vote to “Dark mode”");
    await waitFor(() => expect(calls.onVote).toHaveBeenCalledTimes(1));
    press("Dismiss: “Dark theme”");
    await waitFor(() => expect(calls.onDismiss).toHaveBeenCalledTimes(1));
    expect(view.queryByRole("button", { name: /^Restore/ })).toBeNull();
  });

  it("names a ticket source and an anonymous customer, and offers no vote without a match", () => {
    const view = row(
      signal({
        source: {
          type: "ticket",
          id: "ticket_test_1",
          title: null,
          number: 12,
        },
        customer: { principalId: "principal_test_1", displayName: null },
        matchedPost: null,
      }),
    );
    expect(view.getByText("Ticket #12")).toBeInTheDocument();
    expect(view.getByText("From an anonymous customer")).toBeInTheDocument();
    expect(view.queryByRole("button", { name: /vote/ })).toBeNull();
  });

  it("offers only a restore for a dismissed signal, and none for an accepted one", async () => {
    const calls = actions();
    const dismissed = row(signal({ status: "dismissed" }), calls);
    expect(dismissed.getAllByRole("button")).toHaveLength(1);
    press("Restore: “Dark theme”");
    await waitFor(() => expect(calls.onRestore).toHaveBeenCalledTimes(1));
    dismissed.unmount();
    const accepted = row(
      signal({ status: "accepted", matchedPost: null, resultingPost: post }),
    );
    expect(accepted.getByText("Added to “Dark mode”")).toBeInTheDocument();
    expect(accepted.queryByRole("button")).toBeNull();
  });

  it("hides the controls that the teammate lacks", () => {
    const view = row(signal(), actions(), {
      canAccept: false,
      canReview: true,
    });
    expect(view.getAllByRole("button")).toHaveLength(1);
    expect(
      view.getByRole("button", { name: "Dismiss: “Dark theme”" }),
    ).toBeInTheDocument();
  });
});
