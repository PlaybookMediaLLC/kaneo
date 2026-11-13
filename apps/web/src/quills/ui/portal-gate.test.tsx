import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { PortalGate } from "./portal-gate";

describe("PortalGate", () => {
  it("does not gate a public page", () => {
    const view = renderComponent(
      <PortalGate
        workspaceId="workspace_1"
        audience="public"
        portalEnabled
        accessGranted={false}
        signedIn={false}
      >
        <span>visible</span>
      </PortalGate>,
    );
    expect(view.getByText("visible")).toBeInTheDocument();
  });

  it("asks an anonymous private-portal visitor to sign in on the current page", () => {
    const view = renderComponent(
      <PortalGate
        workspaceId="workspace_1"
        currentPath="/portal/workspace_1/posts/post_1"
        audience="portal"
        portalEnabled
        accessGranted={false}
        signedIn={false}
      >
        <span>hidden</span>
      </PortalGate>,
    );
    expect(view.queryByText("hidden")).not.toBeInTheDocument();
    expect(view.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/auth/sign-in?redirect=%2Fportal%2Fworkspace_1%2Fposts%2Fpost_1",
    );
  });

  it("falls back to portal home for an unsafe return path", () => {
    const view = renderComponent(
      <PortalGate
        workspaceId="workspace_1"
        currentPath="//example.test"
        audience="signed-in"
        portalEnabled
        accessGranted={false}
        signedIn={false}
      >
        <span>hidden</span>
      </PortalGate>,
    );
    expect(view.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/auth/sign-in?redirect=%2Fportal%2Fworkspace_1",
    );
  });
});
