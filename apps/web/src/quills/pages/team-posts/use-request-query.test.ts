import { act } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { advanceClock } from "../../test/actions";
import { renderQuillsHook } from "../../test/render";
import { useRequestQuery } from "./use-request-query";

describe("useRequestQuery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends the trimmed text once after a pause, and nothing for the first value", async () => {
    const onChange = vi.fn();
    const view = renderQuillsHook(() => useRequestQuery("csv", onChange), {});
    expect(view.result.current[0]).toBe("csv");
    act(() => view.result.current[1](" csv export "));
    await advanceClock(100);
    expect(onChange).not.toHaveBeenCalled();
    await advanceClock(300);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("csv export");
    act(() => view.result.current[1]("  "));
    await advanceClock(300);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("takes a new address value without sending it back", async () => {
    const onChange = vi.fn();
    const view = renderQuillsHook(
      ({ q }: { q?: string }) => useRequestQuery(q, onChange),
      { initialProps: { q: "csv" } },
    );
    view.rerender({ q: undefined });
    expect(view.result.current[0]).toBe("");
    await advanceClock(400);
    expect(onChange).not.toHaveBeenCalled();
  });
});
