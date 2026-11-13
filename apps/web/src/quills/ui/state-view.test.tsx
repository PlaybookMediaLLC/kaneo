import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { StateView } from "./state-view";
import { renderComponent } from "../test/render";
import { advanceClock, press } from "../test/actions";

describe("StateView", () => {
  afterEach(() => vi.useRealTimers());
  it("uses an alert for a problem", () => {
    const view = renderComponent(
      <StateView problem={{ kind: "failed" }}>{null}</StateView>,
    );
    expect(view.getByRole("alert")).toBeInTheDocument();
  });
  it("blocks retry until Retry-After expires without retrying automatically", async () => {
    vi.useFakeTimers();
    const retry = vi.fn();
    const view = renderComponent(
      <StateView
        problem={{ kind: "rateLimited", retryAt: Date.now() + 3000 }}
        onRetry={retry}
      >
        {null}
      </StateView>,
    );
    expect(view.getByRole("button")).toBeDisabled();
    press(/try again/i);
    expect(retry).not.toHaveBeenCalled();
    await advanceClock(3000);
    expect(view.getByRole("button", { name: "Try again" })).not.toBeDisabled();
    expect(retry).not.toHaveBeenCalled();
    press("Try again");
    expect(retry).toHaveBeenCalledOnce();
  });
  it("offers a user-controlled retry after a network failure", () => {
    const retry = vi.fn();
    renderComponent(
      <StateView problem={{ kind: "failed" }} onRetry={retry}>
        {null}
      </StateView>,
    );
    press("Try again");
    expect(retry).toHaveBeenCalledOnce();
  });
});
