import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { fetchServerConfig } from "../src/core/config";
import { SDK_VERSION } from "../src/version";

describe("config.fetchServerConfig", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and returns theme from the workspace's Quills config.json", async () => {
    const mock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        enabled: true,
        config: { theme: { lightPrimary: "#ff0000" } },
      }),
    }));
    vi.stubGlobal("fetch", mock);
    const cfg = await fetchServerConfig("https://feedback.acme.com", "acme");
    expect(mock).toHaveBeenCalledWith(
      `https://feedback.acme.com/api/quills-public/acme/widget/config.json?sdk=${SDK_VERSION}`,
      { signal: undefined },
    );
    expect(cfg.theme?.lightPrimary).toBe("#ff0000");
  });

  it("returns empty config while the widget is off", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ enabled: false, config: null }),
      })),
    );
    expect(
      await fetchServerConfig("https://feedback.acme.com", "acme"),
    ).toEqual({});
  });

  it("keeps host analytics off: Kaneo has no pageview ingest route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          enabled: true,
          config: {
            visitorAnalytics: true,
            visitorDeviceTracking: true,
            position: "left",
          },
        }),
      })),
    );
    expect(
      await fetchServerConfig("https://feedback.acme.com", "acme"),
    ).toEqual({ position: "left" });
  });

  it("returns empty config if fetch is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    const cfg = await fetchServerConfig("https://feedback.acme.com", "acme");
    expect(cfg).toEqual({});
  });

  it("swallows network errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const cfg = await fetchServerConfig("https://feedback.acme.com", "acme");
    expect(cfg).toEqual({});
  });
});

it.each([
  null,
  [],
  "wrong",
  { visitorAnalytics: "true" },
  { visitorAnalytics: 1 },
  { visitorAnalytics: true, theme: null },
  { visitorAnalytics: true, launcherLabel: 42 },
  { position: "center" },
])("invalid config fails closed: %j", async (input) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ enabled: true, config: input }),
    })),
  );
  expect(await fetchServerConfig("https://feedback.acme.com", "acme")).toEqual(
    {},
  );
});
