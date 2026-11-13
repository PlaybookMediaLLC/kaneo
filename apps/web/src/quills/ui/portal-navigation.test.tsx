import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { PortalNavigation } from "./portal-navigation";

describe("PortalNavigation", () => {
  it("keeps nested routes in their section and scopes every link to the workspace", () => {
    const view = renderComponent(
      <PortalNavigation
        workspaceId="workspace_test_1"
        currentPath="/portal/workspace_test_1/posts/post_test_1"
      />,
    );
    expect(view.getByRole("link", { name: "Feedback" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(view.getByRole("link", { name: "Help" })).toHaveAttribute(
      "href",
      "/portal/workspace_test_1/hc",
    );
    expect(view.getByRole("link", { name: "Updates" })).not.toHaveAttribute(
      "aria-current",
    );
  });
  it("marks conversation links as support", () => {
    const view = renderComponent(
      <PortalNavigation
        workspaceId="workspace_test_1"
        currentPath="/portal/workspace_test_1/conversations/thread_test_1"
      />,
    );
    expect(view.getByRole("link", { name: "Support" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
