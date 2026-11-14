import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../../test/render";
import { signalsFixture } from "../signals.fixture";
import type { Signal } from "./signal-detail";
import { SignalProperties } from "./signal-properties";

const render = (signal: Signal) =>
  renderComponent(
    <RouterContextProvider
      router={createRouter({
        routeTree: createRootRoute(),
        history: createMemoryHistory(),
      })}
    >
      <SignalProperties workspaceId="workspace_test_1" signal={signal} />
    </RouterContextProvider>,
  );

describe("SignalProperties", () => {
  it("shows the status, the found time and a link to the source conversation", () => {
    const view = render(signalsFixture.signal());
    expect(view.getByText("Pending")).toBeInTheDocument();
    expect(
      view.getByRole("link", { name: "Conversation: Night use" }),
    ).toHaveAttribute(
      "href",
      "/feedback/workspace_test_1/conversations/conversation_test_1",
    );
    expect(view.getByText("Found").nextSibling).toContainElement(
      view.container.querySelector("time"),
    );
  });

  it("links a ticket source with its number", () => {
    const view = render(
      signalsFixture.signal({
        status: "dismissed",
        source: {
          type: "ticket",
          id: "ticket_test_1",
          title: null,
          number: 12,
        },
      }),
    );
    expect(view.getByText("Dismissed")).toBeInTheDocument();
    expect(view.getByRole("link", { name: "Ticket #12" })).toHaveAttribute(
      "href",
      "/feedback/workspace_test_1/tickets/ticket_test_1",
    );
  });
});
