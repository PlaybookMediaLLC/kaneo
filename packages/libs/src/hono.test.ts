import { brandText } from "@kaneo/branding";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { client, windowId } from "./hono";

afterEach(() => vi.unstubAllGlobals());

// The API reads brandText("X-Kaneo-Window-Id") to skip the window that made a
// change; a different name here echoes every change back to its own window.
it("sends the window id under the header name the API reads", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({}));
  vi.stubGlobal("fetch", fetch);
  await client.config.$get();
  const headers = fetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
  expect(headers[brandText("X-Kaneo-Window-Id")]).toBe(windowId);
});
