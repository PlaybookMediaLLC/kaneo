import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { signalsFixture } from "../signals.fixture";
import { SignalListRow } from "./signal-list-row";

describe("SignalListRow", () => {
  it("shows the customer, the title, the words and the source, and opens the signal", () => {
    const onOpen = vi.fn();
    const view = renderComponent(
      <SignalListRow
        signal={signalsFixture.signal()}
        href="/feedback/workspace_test_1/autopilot"
        onOpen={onOpen}
      />,
    );
    const link = view.getByRole("link");
    for (const text of [
      "Ada",
      "Dark theme",
      "Please add a dark mode.",
      "Conversation",
    ])
      expect(link).toHaveTextContent(text);
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("names an anonymous customer and a ticket source", () => {
    const view = renderComponent(
      <SignalListRow
        signal={signalsFixture.signal({
          customer: { principalId: "principal_test_1", displayName: null },
          source: {
            type: "ticket",
            id: "ticket_test_1",
            title: null,
            number: 12,
          },
        })}
        href="/feedback/workspace_test_1/autopilot"
        onOpen={() => undefined}
      />,
    );
    expect(view.getByRole("link")).toHaveTextContent("Anonymous customer");
    expect(view.getByRole("link")).toHaveTextContent("Ticket #12");
  });
});
