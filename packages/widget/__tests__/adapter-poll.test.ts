import { afterEach, expect, it, vi } from "vite-plus/test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createApi } from "../src/adapter/api";
import { useWidgetData } from "../src/adapter/useWidgetData";

afterEach(cleanup);

const message = (id: string, at: string, fromVisitor: boolean) => ({
  id,
  fromVisitor,
  author: fromVisitor ? null : { name: "Ana", avatarUrl: null },
  content: id,
  createdAt: at,
});

it("shows a team reply that arrives after the visitor read the thread", async () => {
  // A small in-memory server: one conversation, team messages count as unread after the read mark.
  const thread = [message("m1", "2026-11-01T00:00:00.000Z", true)];
  let readThrough = "";
  const unread = () =>
    thread.filter((item) => !item.fromVisitor && item.createdAt > readThrough)
      .length;
  const summary = () => ({
    id: "c1",
    subject: "Billing",
    preview: null,
    unreadCount: unread(),
    lastMessageAt: thread[thread.length - 1]!.createdAt,
  });
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace("/base", "");
    const json = (body: unknown) => new Response(JSON.stringify(body));
    if (path === "/widget/unread") return json({ unreadCount: unread() });
    if (path === "/widget/conversations?limit=20")
      return json({ items: [summary()] });
    if (path === "/widget/conversations/c1")
      return json({ conversation: summary(), messages: thread });
    if (path.startsWith("/widget/conversations/c1/messages?after="))
      return json({ items: thread, hasMore: false });
    if (path === "/widget/conversations/c1/read" && init.method === "PUT") {
      readThrough = thread[thread.length - 1]!.createdAt;
      return json({ unreadCount: unread(), changed: true });
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
        changelog: false,
        help: false,
        messenger: true,
      },
      host,
      pollIntervalMs: 20,
    }),
  );
  const ids = () =>
    result.current.conversations?.[0]?.messages.map((m) => m.id);
  await waitFor(() => expect(ids()).toEqual(["m1"]));

  thread.push(message("r1", "2026-11-01T00:01:00.000Z", false));
  await waitFor(() => expect(ids()).toEqual(["m1", "r1"]));
  await act(() => result.current.onReadConversation!("c1", "r1"));
  expect(host.unread).toHaveBeenLastCalledWith(0);

  // The unread count returns to the value it had before the read; the reply must still show.
  thread.push(message("r2", "2026-11-01T00:02:00.000Z", false));
  await waitFor(() => expect(ids()).toEqual(["m1", "r1", "r2"]));
  expect(host.unread).toHaveBeenLastCalledWith(1);
  expect(host.expired).not.toHaveBeenCalled();
});
