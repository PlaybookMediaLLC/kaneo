import { describe, expect, it } from "vite-plus/test";
import { PortalThemeContext } from "../core/portal-theme-context";
import { renderComponent } from "../test/render";
import { Sheet, SheetHeader, SheetTitle, SheetPanel } from "./upstream";
import { PortalSheetContent } from "./portal-sheet-content";

describe("PortalSheetContent", () => {
  it("carries scoped workspace colors into the body-mounted sheet", async () => {
    const view = renderComponent(
      <PortalThemeContext
        value={{ "--popover": "#123456" } as React.CSSProperties}
      >
        <Sheet defaultOpen>
          <PortalSheetContent>
            <SheetHeader>
              <SheetTitle>Example</SheetTitle>
            </SheetHeader>
            <SheetPanel>Content</SheetPanel>
          </PortalSheetContent>
        </Sheet>
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
