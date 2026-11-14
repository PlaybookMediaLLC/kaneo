import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../test/render";
import {
  PortalRuntimeProvider,
  usePortalRuntime,
  type PortalRuntimeValue,
} from "./runtime";

const value: PortalRuntimeValue = {
  config: {
    name: "Workspace",
    features: {
      allowAnonymous: false,
      allowEditAfterEngagement: false,
      allowDeleteAfterEngagement: false,
      showPublicEditHistory: false,
      ai: true,
    },
    portalAccess: { isPrivate: false },
    branding: {
      logoUrl: null,
      theme: { themeMode: "user", light: {}, dark: {} },
      headerDisplayMode: "logo_and_name",
      headerDisplayName: null,
    },
  },
  viewer: { kind: "anonymous" },
  access: { granted: true, reason: "public" },
  accessLoading: false,
  accessProblem: null,
};

function Consumer() {
  return <span>{usePortalRuntime().config.name}</span>;
}

describe("PortalRuntimeProvider", () => {
  it("shares the resolved portal state with a child page", () => {
    const view = renderComponent(
      <PortalRuntimeProvider value={value}>
        <Consumer />
      </PortalRuntimeProvider>,
    );
    expect(view.getByText("Workspace")).toBeInTheDocument();
  });
});
