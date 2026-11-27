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
    expect(cfg?.theme?.lightPrimary).toBe("#ff0000");
  });

  it("accepts null theme color fields and messenger/home tabs from the live API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          enabled: true,
          config: {
            tabs: {
              feedback: true,
              changelog: true,
              help: false,
              messenger: true,
              tickets: true,
              home: true,
            },
            hmacRequired: true,
            ai: false,
            visitorAnalytics: true,
            visitorDeviceTracking: true,
            launcherGreeting: "Need help?",
            launcherLabel: "Support",
            replyTime: "hours",
            home: { greeting: null, subtitle: null, showTeamAvatars: true },
            position: "left",
            theme: {
              themeMode: "user",
              lightPrimary: "#2563eb",
              lightPrimaryForeground: null,
              darkPrimary: null,
              darkPrimaryForeground: null,
            },
          },
        }),
      })),
    );
    const cfg = await fetchServerConfig("https://feedback.acme.com", "acme");
    expect(cfg?.position).toBe("left");
    expect(cfg?.launcherLabel).toBe("Support");
    expect(cfg?.launcherGreeting).toBe("Need help?");
    expect(cfg?.theme?.lightPrimary).toBe("#2563eb");
    expect(cfg?.theme?.darkPrimary).toBeNull();
    expect(cfg?.tabs?.messenger).toBe(true);
    expect(cfg?.tabs?.home).toBe(true);
  });

  it("returns null while the widget is off", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ enabled: false, config: null }),
      })),
    );
    expect(
      await fetchServerConfig("https://feedback.acme.com", "acme"),
    ).toBeNull();
  });

  it("returns null for a workspace that does not exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );
    expect(
      await fetchServerConfig("https://feedback.acme.com", "acme"),
    ).toBeNull();
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

  it("strips trailing slashes from instanceUrl so config URL never has double slashes", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ enabled: true, config: {} }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchServerConfig("https://feedback.acme.com///", "acme");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/feedback\.acme\.com\/api\/quills-public\/acme\/widget\/config\.json\?/,
      ),
      expect.any(Object),
    );
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
