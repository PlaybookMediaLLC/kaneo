import { describe, expect, it, vi } from "vite-plus/test";
import { getPublicStatusPageFixture } from "../../../api/status/get-public-status-page.fixture";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { StatusContent } from "./status-content";

describe("StatusContent", () => {
  it("renders the status heading", () => {
    const view = renderComponent(
      <StatusContent
        workspaceId="workspace_test_1"
        page={getPublicStatusPageFixture.ok()}
        uptime={undefined}
        incidents={[]}
        hasMore={false}
        loadingMore={false}
        onLoadMore={() => undefined}
      />,
    );
    expect(
      view.getByRole("heading", { name: "All systems operational" }),
    ).toBeInTheDocument();
  });
  it("shows and runs the history control", () => {
    const onLoadMore = vi.fn();
    renderComponent(
      <StatusContent
        workspaceId="workspace_test_1"
        page={getPublicStatusPageFixture.ok()}
        uptime={undefined}
        incidents={[]}
        hasMore
        loadingMore={false}
        onLoadMore={onLoadMore}
      />,
    );
    press(/load more history/i);
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});
