import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { signalsFixture } from "../signals.fixture";
import { SignalView } from "./signal-view";

const first = signalsFixture.signal();
const second = signalsFixture.signal({
  id: "feedback_signal_test_2",
  suggestedTitle: "CSV export",
});

/** Renders the open signal beside the given list, with spies for a move and a dismissal. */
const render = (signal = first, signals = [first, second]) => {
  const onMove = vi.fn();
  const onDismiss = vi.fn();
  const view = renderComponent(
    <RouterContextProvider
      router={createRouter({
        routeTree: createRootRoute(),
        history: createMemoryHistory(),
      })}
    >
      <SignalView
        workspaceId="workspace_test_1"
        signal={signal}
        signals={signals}
        message="Restored: “CSV export”."
        problem={{ kind: "failed" }}
        onMove={onMove}
        onBack={() => undefined}
        actions={{
          canAccept: true,
          canReview: true,
          busy: false,
          onAcceptAsPost: () => undefined,
          onVote: () => undefined,
          onDismiss,
          onRestore: () => undefined,
        }}
      />
    </RouterContextProvider>,
  );
  return { view, onMove, onDismiss };
};

describe("SignalView", () => {
  it("shows the compact list, the open signal, its properties, the result and the decisions", () => {
    const { view, onMove, onDismiss } = render();
    const list = view.getByRole("region", { name: "Autopilot" });
    expect(list).toHaveTextContent("CSV export");
    expect(
      view.getByRole("heading", { level: 1, name: "Dark theme" }),
    ).toBeInTheDocument();
    expect(view.getByText("From Ada")).toBeInTheDocument();
    expect(
      view.getByRole("complementary", { name: "Details" }),
    ).toHaveTextContent("Pending");
    expect(view.getByRole("status")).toHaveTextContent(
      "Restored: “CSV export”.",
    );
    expect(view.getByRole("alert")).toBeInTheDocument();
    press("Next");
    expect(onMove).toHaveBeenCalledWith(second.id);
    press("Dismiss");
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("names an anonymous customer in the header", () => {
    const anonymous = signalsFixture.signal({
      customer: { principalId: "principal_test_1", displayName: null },
    });
    const { view } = render(anonymous, [anonymous]);
    expect(view.getByText("From an anonymous customer")).toBeInTheDocument();
  });
});
