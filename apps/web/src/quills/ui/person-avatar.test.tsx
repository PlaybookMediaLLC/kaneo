import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { PersonAvatar } from "./person-avatar";

describe("PersonAvatar", () => {
  it("shows the initial as a hidden decoration", () => {
    const view = renderComponent(<PersonAvatar name=" morgan" />);
    const avatar = view.container.firstElementChild!;
    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(avatar).toHaveTextContent("M");
  });

  it("renders nothing visible for an anonymous author", () => {
    const view = renderComponent(<PersonAvatar name={null} />);
    expect(view.container.firstElementChild).toHaveTextContent("");
  });

  it("shows two initials on the tone of the name when colored", () => {
    const view = renderComponent(<PersonAvatar name="Ada Lovelace" colored />);
    const avatar = view.container.firstElementChild!;
    expect(avatar).toHaveTextContent("AL");
    expect(avatar.className).toMatch(/bg-\w+\/\d+/);
  });
});
