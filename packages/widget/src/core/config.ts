import { SDK_VERSION } from "../version.js";

export interface ServerConfig {
  theme?: {
    lightPrimary?: string | null;
    lightPrimaryForeground?: string | null;
    darkPrimary?: string | null;
    darkPrimaryForeground?: string | null;
    themeMode?: "light" | "dark" | "user";
  };
  tabs?: {
    feedback?: boolean;
    changelog?: boolean;
    help?: boolean;
    chat?: boolean;
    messenger?: boolean;
    tickets?: boolean;
    home?: boolean;
  };
  imageUploadsInWidget?: boolean;
  hmacRequired?: boolean;
  visitorAnalytics?: boolean;
  visitorDeviceTracking?: boolean;
  launcherGreeting?: string | null;
  launcherLabel?: string | null;
  position?: "left" | "right";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optBool(
  obj: Record<string, unknown>,
  key: string,
): boolean | undefined | null {
  const v = obj[key];
  if (v === undefined) return undefined;
  return typeof v === "boolean" ? v : null;
}

/** Unknown config fields are ignored; malformed known fields fail closed. */
export const serverConfigSchema = {
  safeParse(
    raw: unknown,
  ): { success: true; data: ServerConfig } | { success: false } {
    if (!isRecord(raw)) return { success: false };
    const out: ServerConfig = {};
    if (raw.theme !== undefined) {
      if (!isRecord(raw.theme)) return { success: false };
      const t: NonNullable<ServerConfig["theme"]> = {};
      for (const k of [
        "lightPrimary",
        "lightPrimaryForeground",
        "darkPrimary",
        "darkPrimaryForeground",
      ] as const) {
        const rawVal = raw.theme[k];
        if (rawVal === undefined) continue;
        if (rawVal !== null && typeof rawVal !== "string")
          return { success: false };
        t[k] = rawVal;
      }
      if (raw.theme.themeMode !== undefined) {
        if (
          raw.theme.themeMode !== "light" &&
          raw.theme.themeMode !== "dark" &&
          raw.theme.themeMode !== "user"
        ) {
          return { success: false };
        }
        t.themeMode = raw.theme.themeMode;
      }
      out.theme = t;
    }
    if (raw.tabs !== undefined) {
      if (!isRecord(raw.tabs)) return { success: false };
      const tabs: NonNullable<ServerConfig["tabs"]> = {};
      for (const k of [
        "feedback",
        "changelog",
        "help",
        "chat",
        "messenger",
        "tickets",
        "home",
      ] as const) {
        const v = optBool(raw.tabs, k);
        if (v === null) return { success: false };
        if (v !== undefined) tabs[k] = v;
      }
      out.tabs = tabs;
    }
    for (const k of [
      "imageUploadsInWidget",
      "hmacRequired",
      "visitorAnalytics",
      "visitorDeviceTracking",
    ] as const) {
      const v = optBool(raw, k);
      if (v === null) return { success: false };
      if (v !== undefined) out[k] = v;
    }
    for (const k of ["launcherGreeting", "launcherLabel"] as const) {
      const v = raw[k];
      if (v === undefined) continue;
      if (v !== null && typeof v !== "string") return { success: false };
      out[k] = v;
    }
    if (raw.position !== undefined) {
      if (raw.position !== "left" && raw.position !== "right") {
        return { success: false };
      }
      out.position = raw.position;
    }
    return { success: true, data: out };
  },
};

/** The widget's base path on a Kaneo instance, custom domain, or reverse proxy (#318). */
export const widgetBase = (
  instanceUrl?: string,
  workspace?: string,
  baseUrl?: string,
) =>
  baseUrl
    ? baseUrl.replace(/\/+$/, "")
    : `${(instanceUrl ?? "").replace(/\/+$/, "")}/api/quills-public/${encodeURIComponent(workspace ?? "")}/widget`;

/**
 * Null when the instance says the widget is off or the workspace does not exist; `{}` when the
 * config could not be read, so a transient failure still shows the launcher. The version query
 * keeps this cross-origin GET free of custom-header preflights. Uses `credentials: "omit"` for
 * zero-cookie operation (#318).
 */
export async function fetchServerConfig(
  instanceUrl?: string,
  workspace?: string,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<ServerConfig | null> {
  try {
    const url = `${widgetBase(instanceUrl, workspace, baseUrl)}/config.json?sdk=${encodeURIComponent(SDK_VERSION)}`;
    const res = await fetch(url, { signal, credentials: "omit" });
    if (res.status === 404) return null;
    if (!res.ok) return {};
    // The Quills API wraps the config as { enabled, config }; config is null while the widget is off.
    const body: unknown = await res.json();
    if ((body as { enabled?: unknown } | null)?.enabled === false) return null;
    const parsed = serverConfigSchema.safeParse(
      body && typeof body === "object" && "config" in body
        ? (body as { config?: unknown }).config
        : body,
    );
    if (!parsed.success) return {};
    // Kaneo has no pageview ingest route yet: keep host-page analytics and the device ID off.
    const {
      visitorAnalytics: _a,
      visitorDeviceTracking: _d,
      ...config
    } = parsed.data;
    return config;
  } catch {
    return {};
  }
}
