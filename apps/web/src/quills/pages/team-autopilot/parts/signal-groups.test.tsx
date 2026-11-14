import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { signalsFixture } from "../signals.fixture";
import { SignalGroups } from "./signal-groups";

const signal = signalsFixture.signal();

describe("SignalGroups", () => {
  it("shows the signals under their group, marks the highlight and opens a signal", () => {
    const onOpen = vi.fn();
    const onLoadMore = vi.fn();
    const view = renderComponent(
      <SignalGroups
        workspaceId="workspace_test_1"
        groups={[
          { id: "match", label: "Matches a post", items: [signal] },
          { id: "new", label: "New requests", items: [] },
        ]}
        cursor={signal.id}
        onOpen={onOpen}
        onLoadMore={onLoadMore}
        loadingMore={false}
      />,
    );
    expect(
      view.getByRole("group", { name: "Matches a post 1" }),
    ).toBeInTheDocument();
    expect(view.queryByRole("group", { name: /New requests/ })).toBeNull();
    const link = view.getByRole("link");
    expect(link).toHaveAttribute("aria-current", "true");
    expect(link).toHaveAttribute(
      "href",
      "/feedback/workspace_test_1/autopilot",
    );
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledWith(signal.id);
    press("Load more signals");
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("offers no more signals when the API has none", () => {
    const view = renderComponent(
      <SignalGroups
        workspaceId="workspace_test_1"
        groups={[{ id: "new", label: "New requests", items: [signal] }]}
        cursor={null}
        onOpen={() => undefined}
        loadingMore={false}
      />,
    );
    expect(view.queryByRole("button")).toBeNull();
  });
});
