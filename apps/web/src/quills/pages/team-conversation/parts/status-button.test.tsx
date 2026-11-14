import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../../../test/actions";
import { renderComponent } from "../../../test/render";
import { StatusButton } from "./status-button";

describe("StatusButton", () => {
  it("resolves an open conversation", () => {
    const onResolve = vi.fn();
    renderComponent(
      <StatusButton status="open" onResolve={onResolve} onReopen={vi.fn()} />,
    );
    press("Resolve");
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it("shows a resolved conversation and reopens it", () => {
    const onReopen = vi.fn();
    const view = renderComponent(
      <StatusButton status="closed" onResolve={vi.fn()} onReopen={onReopen} />,
    );
    expect(
      view.getByRole("button", { name: "Resolved, reopen" }),
    ).toHaveTextContent("Resolved");
    press("Resolved, reopen");
    expect(onReopen).toHaveBeenCalledTimes(1);
  });
});
