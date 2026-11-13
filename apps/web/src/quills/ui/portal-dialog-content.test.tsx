import { describe, expect, it } from "vite-plus/test";
import { PortalThemeContext } from "../core/portal-theme-context";
import { renderComponent } from "../test/render";
import { Dialog, DialogTitle } from "./upstream";
import { PortalDialogContent } from "./portal-dialog-content";

describe("PortalDialogContent", () => {
  it("carries scoped workspace colors into the body-mounted dialog", async () => {
    const view = renderComponent(
      <PortalThemeContext
        value={{ "--popover": "#123456" } as React.CSSProperties}
      >
        <Dialog defaultOpen>
          <PortalDialogContent>
            <DialogTitle>Example</DialogTitle>
          </PortalDialogContent>
        </Dialog>
      </PortalThemeContext>,
    );
    expect(await view.findByRole("dialog", { name: "Example" })).toHaveStyle(
      "--popover: #123456",
    );
    expect(document.documentElement.style.getPropertyValue("--popover")).toBe(
      "",
    );
  });
});
