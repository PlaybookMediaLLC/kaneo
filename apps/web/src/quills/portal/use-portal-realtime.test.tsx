import { act } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { renderQuillsHook } from "../test/render";
import { usePortalRealtime } from "./use-portal-realtime";

class MockSocket {
  static OPEN = 1;
  static instances: MockSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event?: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
  });
  constructor(public url: string) {
    MockSocket.instances.push(this);
  }
}

describe("usePortalRealtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockSocket.instances = [];
    vi.stubGlobal("WebSocket", MockSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not connect for anonymous portal visitors", () => {
    renderQuillsHook(
      () => usePortalRealtime("ws_1", { kind: "anonymous" }, true),
      {},
    );
    expect(MockSocket.instances).toHaveLength(0);
  });

  it("invalidates support queries for signed-in customers on QUILLS_CUSTOMER_CHANGED", () => {
    const { queryClient, unmount } = renderQuillsHook(
      () => usePortalRealtime("ws_slug", { kind: "user", id: "user_1" }, true),
      {},
    );
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    expect(MockSocket.instances).toHaveLength(1);
    const socket = MockSocket.instances[0]!;
    act(() => {
      socket.readyState = 1;
      socket.onopen?.();
      socket.onmessage?.({
        data: JSON.stringify({
          type: "QUILLS_CUSTOMER_CHANGED",
          workspaceId: "ws_canonical",
          eventId: "evt_1",
          conversationId: "conv_1",
        }),
      });
    });
    expect(spy).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(150));
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["quills", "ws_slug", "user_1", "support"],
    });
    unmount();
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("evicts private queries and stops reconnecting on USER_ACCESS_REVOKED", () => {
    const { queryClient } = renderQuillsHook(
      () => usePortalRealtime("ws_slug", { kind: "user", id: "user_1" }, true),
      {},
    );
    const removeSpy = vi.spyOn(queryClient, "removeQueries");
    const socket = MockSocket.instances[0]!;
    act(() => {
      socket.readyState = 1;
      socket.onopen?.();
      socket.onmessage?.({
        data: JSON.stringify({ type: "USER_ACCESS_REVOKED" }),
      });
    });
    expect(socket.close).toHaveBeenCalledOnce();
    expect(removeSpy).toHaveBeenCalledWith({
      queryKey: ["quills", "ws_slug", "user_1"],
    });
    act(() => vi.advanceTimersByTime(60_000));
    expect(MockSocket.instances).toHaveLength(1);
  });

  it("evicts private queries and stops reconnecting on auth close code 4001", () => {
    const { queryClient } = renderQuillsHook(
      () => usePortalRealtime("ws_slug", { kind: "user", id: "user_1" }, true),
      {},
    );
    const removeSpy = vi.spyOn(queryClient, "removeQueries");
    const socket = MockSocket.instances[0]!;
    act(() => {
      socket.onclose?.({ code: 4001 });
    });
    expect(removeSpy).toHaveBeenCalledWith({
      queryKey: ["quills", "ws_slug", "user_1"],
    });
    act(() => vi.advanceTimersByTime(60_000));
    expect(MockSocket.instances).toHaveLength(1);
  });
});
