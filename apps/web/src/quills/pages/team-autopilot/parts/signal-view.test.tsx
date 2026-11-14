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

describe("SignalView", () => {
  it("shows the compact list, the open signal, its properties, the result and the decisions", () => {
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
          signal={first}
          signals={[first, second]}
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
    const list = view.getByRole("region", { name: "Autopilot" });
    expect(list).toHaveTextContent("CSV export");
    expect(
      view.getByRole("heading", { level: 1, name: "Dark theme" }),
    ).toBeInTheDocument();
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
});
