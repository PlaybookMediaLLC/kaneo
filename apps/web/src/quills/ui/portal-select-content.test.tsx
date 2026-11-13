import { describe, expect, it } from "vite-plus/test";
import { PortalThemeContext } from "../core/portal-theme-context";
import { renderComponent } from "../test/render";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./upstream";
import { PortalSelectContent } from "./portal-select-content";

describe("PortalSelectContent", () => {
  it("carries scoped workspace colors into the body-mounted popup", async () => {
    const view = renderComponent(
      <PortalThemeContext
        value={{ "--popover": "#123456" } as React.CSSProperties}
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
      </PortalThemeContext>,
    );
    expect(
      (await view.findByRole("option", { name: "One" })).closest(
        '[data-slot="select-popup"]',
      ),
    ).toHaveStyle("--popover: #123456");
    expect(document.documentElement.style.getPropertyValue("--popover")).toBe(
      "",
    );
  });
});
