import { fireEvent } from "@testing-library/react";
import { X } from "lucide-react";
import { describe, expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../upstream";
import { IconButton } from "./icon-button";

describe("IconButton", () => {
  it("names the button and shows the name in a tooltip", async () => {
    const onClick = vi.fn();
    const view = renderComponent(
      <IconButton label="Remove Ada" onClick={onClick}>
        <X aria-hidden="true" />
      </IconButton>,
    );
    const button = view.getByRole("button", { name: "Remove Ada" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.focus(button);
    expect(await view.findByText("Remove Ada")).toBeVisible();
  });

  it("can be the trigger of a menu", async () => {
    const view = renderComponent(
      <Menu>
        <MenuTrigger render={<IconButton label="More" />}>
          <X aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup>
          <MenuItem>Snooze</MenuItem>
        </MenuPopup>
      </Menu>,
    );
    fireEvent.click(view.getByRole("button", { name: "More" }));
    expect(await view.findByRole("menuitem", { name: "Snooze" })).toBeVisible();
  });
});
