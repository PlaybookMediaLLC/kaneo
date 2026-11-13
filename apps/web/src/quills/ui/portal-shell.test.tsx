import { describe, expect, it } from "vite-plus/test";
import { PortalShell } from "./portal-shell";
import { renderComponent } from "../test/render";

const branding = {
  logoUrl: null,
  theme: { themeMode: "light" as const, light: {}, dark: {} },
  headerDisplayMode: "logo_and_name" as const,
  headerDisplayName: null,
};

describe("PortalShell", () => {
  it("shows the workspace name", () => {
    const view = renderComponent(
      <PortalShell workspaceName="Workspace" branding={branding}>
        {null}
      </PortalShell>,
    );
    expect(view.getByText("Workspace")).toBeInTheDocument();
    expect(view.getByRole("banner").parentElement).toHaveClass(
      "h-full",
      "min-h-0",
      "overflow-y-auto",
    );
  });

  it("shows a custom logo and accessible display name", () => {
    const view = renderComponent(
      <PortalShell
        workspaceName="Workspace"
        branding={{
          ...branding,
          logoUrl: "https://example.test/logo.png",
          headerDisplayMode: "logo_only",
          headerDisplayName: "Customer portal",
        }}
      >
        {null}
      </PortalShell>,
    );
    expect(
      view.getByRole("img", { name: "Customer portal" }),
    ).toBeInTheDocument();
    expect(view.queryByText("Customer portal")).not.toBeInTheDocument();
  });

  it("keeps workspace theme variables on the portal container", () => {
    const view = renderComponent(
      <PortalShell
        workspaceName="Workspace"
        branding={{
          ...branding,
          theme: {
            ...branding.theme,
            light: { primaryForeground: "oklch(1 0 0)" },
          },
        }}
      >
        {null}
      </PortalShell>,
    );
    const container = view.getByRole("banner").parentElement;
    expect(container).toHaveStyle("--primary-foreground: oklch(1 0 0)");
    expect(document.documentElement).not.toHaveStyle(
      "--primary-foreground: oklch(1 0 0)",
    );
  });
});
