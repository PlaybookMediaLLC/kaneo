import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

describe("GET /api/openapi caching", () => {
  let createApp: typeof import("../../apps/api/src/index").createApp;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-openapi-cache-secret-at-least-32-chars";
    ({ createApp } = await import("../../apps/api/src/index"));
  }, 30_000);

  it("memoizes the OpenAPI document and answers 304 on matching ETag", async () => {
    const { app, api } = createApp();
    const spy = vi.spyOn(api, "getOpenAPI31Document");

    const first = await app.request("/api/openapi");
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    expect(first.headers.get("cache-control")).toBe("public, max-age=300");
    const firstBody = await first.text();
    expect(spy).toHaveBeenCalledTimes(1);

    const second = await app.request("/api/openapi");
    expect(second.status).toBe(200);
    expect(second.headers.get("etag")).toBe(etag);
    expect(await second.text()).toBe(firstBody);
    expect(spy).toHaveBeenCalledTimes(1);

    const notModified = await app.request("/api/openapi", {
      headers: { "If-None-Match": etag! },
    });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("etag")).toBe(etag);
    expect(await notModified.text()).toBe("");
    expect(spy).toHaveBeenCalledTimes(1);

    const weakNotModified = await app.request("/api/openapi", {
      headers: { "If-None-Match": `"other", W/${etag!}` },
    });
    expect(weakNotModified.status).toBe(304);
    expect(weakNotModified.headers.get("etag")).toBe(etag);
    expect(spy).toHaveBeenCalledTimes(1);
  }, 15_000);
});
