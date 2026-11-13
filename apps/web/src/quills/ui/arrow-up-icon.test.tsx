import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { ArrowUpIcon } from "./arrow-up-icon";

describe("ArrowUpIcon", () => {
  it("is decorative and keeps extra classes", () => {
    const icon = renderComponent(<ArrowUpIcon className="size-4" />).container
      .firstElementChild!;
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveClass("size-4");
    expect(icon).not.toHaveClass("size-3");
  });
});
