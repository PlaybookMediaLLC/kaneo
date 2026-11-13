import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { StatusIcon } from "./status-icon";

describe("StatusIcon", () => {
  it("draws an empty ring for open and a full mark for shipped and closed", () => {
    const icon = (stage: string | null) =>
      renderComponent(<StatusIcon stage={stage} color="teal" />).container
        .firstElementChild!;
    const open = icon("open");
    expect(open).toHaveAttribute("aria-hidden", "true");
    expect(open).toHaveAttribute("color", "teal");
    expect(open.querySelector("circle")).toHaveAttribute("fill", "none");
    expect(open.querySelectorAll("path")).toHaveLength(0);
    expect(icon("planned").querySelectorAll("path")).toHaveLength(1);
    expect(icon("shipped").querySelector("circle")).toHaveAttribute(
      "fill",
      "currentColor",
    );
    expect(icon(null).querySelectorAll("path")).toHaveLength(1);
  });
});
