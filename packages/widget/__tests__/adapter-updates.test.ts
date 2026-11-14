import { afterEach, expect, it, vi } from "vite-plus/test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createApi } from "../src/adapter/api";
import { toUpdate } from "../src/adapter/map";
import { useWidgetData } from "../src/adapter/useWidgetData";

afterEach(cleanup);

// Changelog engagement over the real widget routes (RFC 0003, feature 15): reactions, the read
// mark and the unread count that the launcher badge shows.

it("maps reactions and the unread flag, offering the common emoji", () => {
  const update = toUpdate({
    id: "e1",
    title: "Exports",
    content: "CSV export.",
    publishedAt: "2026-11-02T12:00:00.000Z",
    author: null,
    linkedPosts: [],
    requesterCount: 0,
    reactions: [{ emoji: "🚀", count: 2, reacted: true }],
    unread: true,
  });
  expect(update.unread).toBe(true);
  expect(update.reactions).toEqual([
    { emoji: "👍", count: 0, reacted: false },
    { emoji: "❤️", count: 0, reacted: false },
    { emoji: "🎉", count: 0, reacted: false },
    { emoji: "🚀", count: 2, reacted: true },
  ]);
});

it("reacts, marks updates read and keeps the launcher badge current", async () => {
  let reactions = [{ emoji: "🎉", count: 1, reacted: false }];
  let unread = 2;
  const requests: { method: string; path: string; body: unknown }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace("/base", "");
    requests.push({
      method: init.method ?? "GET",
      path,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const json = (body: unknown) => new Response(JSON.stringify(body));
    if (path === "/widget/changelog/unread") return json({ count: unread });
    if (path.startsWith("/widget/changelog?"))
      return json({
        entries: [
          {
            id: "e1",
            title: "Exports",
            content: "CSV export.",
            publishedAt: "2026-11-02T12:00:00.000Z",
            author: null,
            linkedPosts: [],
            requesterCount: 0,
            reactions,
            unread: unread > 0,
          },
        ],
        nextOffset: null,
      });
    if (path === "/widget/changelog/e1/reactions" && init.method === "PUT") {
      reactions = [{ emoji: "🎉", count: 2, reacted: true }];
      return json({ entryId: "e1", changed: true, reactions });
    }
    if (path === "/widget/changelog/read" && init.method === "PUT") {
      unread = 0;
      return json({ lastReadAt: "2026-11-03T00:00:00.000Z" });
    }
    return new Response(JSON.stringify({ message: "Not found" }), {
      status: 404,
    });
  });
  const api = createApi("/base", fetchImpl as unknown as typeof fetch);
  api.setToken("tok");
  const host = { event: vi.fn(), unread: vi.fn(), expired: vi.fn() };
  const { result } = renderHook(() =>
    useWidgetData({
      api,
      session: 1,
      active: true,
      surfaces: {
        feedback: false,
        changelog: true,
        help: false,
        messenger: false,
      },
      host,
      pollIntervalMs: 20,
    }),
  );
  await waitFor(() => expect(result.current.updates).toHaveLength(1));
  await waitFor(() => expect(host.unread).toHaveBeenLastCalledWith(2));
  expect(result.current.updates![0]!.unread).toBe(true);

  await act(() => result.current.onReactToUpdate!("e1", "🎉"));
  expect(requests.find((r) => r.path.endsWith("/reactions"))?.body).toEqual({
    emoji: "🎉",
    reacted: true,
  });
  expect(
    result.current.updates![0]!.reactions!.find((r) => r.emoji === "🎉"),
  ).toEqual({ emoji: "🎉", count: 2, reacted: true });

  await act(() => result.current.onReadUpdate!("e1"));
  expect(result.current.updates![0]!.unread).toBe(false);
  expect(host.unread).toHaveBeenLastCalledWith(0);
});
