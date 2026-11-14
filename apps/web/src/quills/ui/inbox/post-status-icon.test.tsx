import { describe, expect, it } from "vite-plus/test";
import { renderComponent } from "../../test/render";
import { PostStatusIcon } from "./post-status-icon";

const icon = (progress: number) =>
  renderComponent(<PostStatusIcon progress={progress} color="teal" />).container
    .firstElementChild!;

describe("PostStatusIcon", () => {
  it("is an empty square for the first status and fills as the status advances", () => {
    const first = icon(0);
    expect(first).toHaveAttribute("aria-hidden", "true");
    expect(first).toHaveAttribute("color", "teal");
    expect(first.querySelectorAll("rect")).toHaveLength(1);
    const half = icon(0.5).querySelectorAll("rect");
    expect(half).toHaveLength(2);
    expect(half[1]).toHaveAttribute("height", "3");
  });

  it("is full with a check for a complete status", () => {
    const done = icon(1);
    expect(done.querySelector("rect")).toHaveAttribute("fill", "currentColor");
    expect(done.querySelector("path")).toBeInTheDocument();
  });
});
