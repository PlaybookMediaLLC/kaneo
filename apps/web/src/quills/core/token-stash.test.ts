import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  clearTokenStash,
  removeTokenFromAddress,
  stashToken,
  takeStashedToken,
} from "./token-stash";

describe("token stash", () => {
  beforeEach(() => {
    localStorage.clear();
    clearTokenStash();
    vi.useRealTimers();
  });
  it("removes a query token before returning it", () => {
    window.history.replaceState(
      {},
      "",
      "/portal/workspace/unsubscribe?token=secret&keep=yes",
    );
    expect(removeTokenFromAddress("query")).toBe("secret");
    expect(window.location.search).toBe("?keep=yes");
  });
  it("expires memory and persisted tokens after thirty minutes", () => {
    vi.useFakeTimers();
    stashToken("expired", "synthetic-token", true);
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    window.dispatchEvent(new Event("pageshow"));
    expect(localStorage.getItem("quills-link-token:expired")).toBeNull();
    expect(takeStashedToken("expired")).toBeNull();
    vi.useRealTimers();
  });
  it("does not return an expired memory-only token", () => {
    vi.useFakeTimers();
    stashToken("memory-only", "synthetic-token");
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    expect(takeStashedToken("memory-only")).toBeNull();
    vi.useRealTimers();
  });
  it("takes a persisted token once", () => {
    stashToken("workspace:record", "secret", true);
    expect(takeStashedToken("workspace:record")).toBe("secret");
    expect(takeStashedToken("workspace:record")).toBeNull();
  });
});
