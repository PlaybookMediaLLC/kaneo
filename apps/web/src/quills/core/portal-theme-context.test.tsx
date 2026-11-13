import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { PortalShell } from "../ui/portal-shell";
import { PortalSelectContent } from "../ui/portal-select-content";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/upstream";

describe("portal theme propagation", () => {
  it("applies workspace branding to a popup outside the shell without changing the host", async () => {
    const view = renderComponent(
      <PortalShell
        workspaceName="Workspace"
        branding={{
          logoUrl: null,
          headerDisplayMode: "logo_and_name",
          headerDisplayName: null,
          theme: {
            themeMode: "light",
            light: { popover: "#123456" },
            dark: {},
          },
        }}
      >
        <Select
          defaultOpen
          defaultValue="one"
          items={[{ value: "one", label: "One" }]}
        >
          <SelectTrigger aria-label="Example">
            <SelectValue />
          </SelectTrigger>
          <PortalSelectContent>
            <SelectGroup>
              <SelectItem value="one">One</SelectItem>
            </SelectGroup>
          </PortalSelectContent>
        </Select>
      </PortalShell>,
    );
    const option = await view.findByRole("option", { name: "One" });
    expect(option.closest(".portal-shell")).toBeNull();
    expect(option.closest('[data-slot="select-popup"]')).toHaveStyle(
      "--popover: #123456",
    );
    expect(document.documentElement.style.getPropertyValue("--popover")).toBe(
      "",
    );
  });
});
